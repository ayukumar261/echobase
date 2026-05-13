"""BullMQ worker entry point.

Consumes jobs from the `tasks` queue produced by `apps/hono-api`. For each
job we:

  1. Resolve the user's GitHub access token via the Hono API's internal
     endpoint (the token never lives on disk here).
  2. Spin up an E2B sandbox and clone the target repo into it using a
     short-lived `x-access-token` URL.
  3. Run the coding agent loop (`run_agent_loop`) until it calls `finish`.
  4. Create a branch, commit, push, and open a *draft* PR via `gh` (with a
     REST fallback in case `gh` isn't installed in the sandbox image).
  5. Return a JSON-serializable result so BullMQ marks the job complete.

The sandbox is always torn down on exit — that's our containment story for
the plaintext token, which is only ever in the sandbox's process env and
the embedded clone URL.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shlex
import signal
from typing import Any

import httpx
from bullmq import Job, Worker
from dotenv import load_dotenv

from .loop import FinishEnvelope, run_agent_loop
from .sandbox import (
    WorkspaceSandbox,
    authed_clone_url,
    fetch_github_token,
    open_sandbox,
)

load_dotenv()

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(name)s: %(message)s")


# ---- branch / PR helpers --------------------------------------------------


_BRANCH_RE = re.compile(r"[^A-Za-z0-9._/-]+")


def _safe_branch_name(raw: str) -> str:
    """Make a branch name git will accept.

    The agent picks the name, but we still scrub it: replace anything outside
    `[A-Za-z0-9._/-]` with `-`, collapse repeats, and trim leading/trailing
    separators. If the result is empty we fall back to a generic name.
    """
    cleaned = _BRANCH_RE.sub("-", raw).strip("-/.")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    if not cleaned:
        cleaned = "agent/change"
    return cleaned[:120]  # GitHub allows much more, but keep it sane


async def _create_pr_via_rest(
    *,
    token: str,
    repository: str,
    branch: str,
    base: str,
    title: str,
    body: str,
) -> str:
    """Fallback PR creation when `gh` isn't available. Returns the PR URL."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"https://api.github.com/repos/{repository}/pulls",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            json={
                "title": title,
                "body": body,
                "head": branch,
                "base": base,
                "draft": True,
            },
        )
    if resp.status_code >= 300:
        raise RuntimeError(
            f"GitHub PR create failed ({resp.status_code}): {resp.text}"
        )
    return resp.json()["html_url"]


async def _commit_push_pr(
    sbx: WorkspaceSandbox,
    envelope: FinishEnvelope,
    *,
    repository: str,
    base_branch: str,
    token: str,
) -> dict[str, Any]:
    """Run the post-agent git plumbing. Returns a result dict for BullMQ."""
    if not await sbx.has_uncommitted_changes():
        log.info("no changes after agent run; skipping PR")
        return {
            "ok": True,
            "prUrl": None,
            "branch": None,
            "summary": envelope.summary,
            "noop": True,
        }

    branch = _safe_branch_name(envelope.branch_name or "agent/change")
    title = envelope.pr_title or "Agent change"
    body = envelope.pr_body or envelope.summary or ""

    # Stage + commit. We pass the commit message via `-F -` to dodge any
    # shell-quoting issues with multi-line bodies.
    commit_message = f"{title}\n\n{body}" if body else title
    code, _, err = await sbx.run_with_token(
        f"git checkout -b {shlex.quote(branch)} && "
        f"git add -A && "
        f"git commit -F - <<'ECHOBASE_MSG_EOF'\n{commit_message}\nECHOBASE_MSG_EOF",
        token=token,
        timeout=60,
    )
    if code != 0:
        raise RuntimeError(f"commit failed: {err.strip()}")

    # Set the remote to the authed URL right before push. E2B's git.clone
    # strips the credential from `origin` after the initial fetch, so we can't
    # rely on it being present. Doing this here (rather than after clone) keeps
    # the token out of `git remote -v` for the duration of the agent loop.
    authed = f"https://x-access-token:{token}@github.com/{repository}.git"
    code, _, err = await sbx.run_with_token(
        f"git remote set-url origin {shlex.quote(authed)}",
        token=token,
        timeout=15,
    )
    if code != 0:
        raise RuntimeError(f"remote set-url failed: {err.strip()}")

    code, _, err = await sbx.run_with_token(
        f"git push -u origin {shlex.quote(branch)}",
        token=token,
        timeout=120,
    )
    if code != 0:
        raise RuntimeError(f"push failed: {err.strip()}")

    # Try `gh` first. If it's missing (older E2B images), fall back to REST.
    code, out, err = await sbx.run_with_token(
        "command -v gh >/dev/null 2>&1 && gh --version",
        token=token,
        timeout=10,
    )
    if code == 0:
        gh_cmd = (
            "gh pr create --draft "
            f"--repo {shlex.quote(repository)} "
            f"--base {shlex.quote(base_branch)} "
            f"--head {shlex.quote(branch)} "
            f"--title {shlex.quote(title)} "
            "--body-file -"
        )
        code, out, err = await sbx.run_with_token(
            f"{gh_cmd} <<'ECHOBASE_BODY_EOF'\n{body}\nECHOBASE_BODY_EOF",
            token=token,
            timeout=60,
        )
        if code != 0:
            log.warning("gh pr create failed (%s); falling back to REST", err.strip())
            pr_url = await _create_pr_via_rest(
                token=token,
                repository=repository,
                branch=branch,
                base=base_branch,
                title=title,
                body=body,
            )
        else:
            # `gh` prints the URL on stdout.
            pr_url = out.strip().splitlines()[-1] if out.strip() else ""
    else:
        log.info("gh CLI not available in sandbox; using REST")
        pr_url = await _create_pr_via_rest(
            token=token,
            repository=repository,
            branch=branch,
            base=base_branch,
            title=title,
            body=body,
        )

    return {
        "ok": True,
        "prUrl": pr_url,
        "branch": branch,
        "summary": envelope.summary,
        "noop": False,
    }


# ---- BullMQ entry --------------------------------------------------------


async def process(job: Job, job_token: str) -> dict[str, Any]:
    data = job.data
    log.info(
        "job received: id=%s name=%s taskId=%s repo=%s",
        job.id,
        job.name,
        data.get("taskId"),
        data.get("repository"),
    )

    spec = data.get("task")
    user_id = data.get("userId")
    repository = data.get("repository")
    base_branch = data.get("baseBranch") or "main"

    if not isinstance(spec, str) or not spec.strip():
        return {"ok": False, "error": "missing task spec"}
    if not isinstance(user_id, str) or not user_id:
        return {"ok": False, "error": "missing userId"}
    if not isinstance(repository, str) or "/" not in repository:
        return {"ok": False, "error": "missing or invalid repository"}

    try:
        token, login = await fetch_github_token(user_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("failed to fetch github token")
        return {"ok": False, "error": f"token_fetch_failed: {exc}"}

    clone_url = authed_clone_url(repository, token)

    try:
        async with open_sandbox(clone_url=clone_url) as sbx:
            await sbx.configure_git_identity(
                name=login,
                email=f"{login}@users.noreply.github.com",
            )
            envelope = await run_agent_loop(
                spec, sbx, repository=repository, base_branch=base_branch
            )

            if not envelope.completed:
                log.warning(
                    "agent did not complete: %s", envelope.summary[:200]
                )
                return {
                    "ok": False,
                    "error": "agent_incomplete",
                    "summary": envelope.summary,
                }

            result = await _commit_push_pr(
                sbx,
                envelope,
                repository=repository,
                base_branch=base_branch,
                token=token,
            )
    except Exception as exc:  # noqa: BLE001
        log.exception("job failed")
        return {"ok": False, "error": str(exc)}

    result["jobId"] = job.id
    log.info(
        "job %s done: prUrl=%s branch=%s noop=%s",
        job.id,
        result.get("prUrl"),
        result.get("branch"),
        result.get("noop"),
    )
    log.info("summary:\n%s", result.get("summary", ""))
    return result


async def main() -> None:
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        raise RuntimeError("REDIS_URL is required")

    queue_name = os.environ.get("QUEUE_NAME", "tasks")
    concurrency = int(os.environ.get("WORKER_CONCURRENCY", "1"))

    worker = Worker(
        queue_name,
        process,
        {"connection": redis_url, "concurrency": concurrency},
    )

    log.info(
        "listening on queue=%r concurrency=%d redis=%s",
        queue_name,
        concurrency,
        redis_url,
    )

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    await stop.wait()
    log.info("shutting down...")
    await worker.close()
    log.info("closed.")


def run() -> None:
    asyncio.run(main())


if __name__ == "__main__":
    run()
