"""E2B sandbox helpers for the agent loop.

Spins up an E2B sandbox, clones the user's GitHub repo into it with a
short-lived authenticated URL, and exposes the read/write tools the
agent uses during a job. Mirrors the pattern in
`apps/pipecat-ws/src/pipecat_ws/services/sandbox.py`, but tailored for the
BullMQ worker's lifecycle (one sandbox per job).

The plaintext access token never lives on the worker's disk: we fetch it
from the Hono API's `/api/internal/github-token` endpoint, embed it in the
remote URL, and rely on the sandbox being torn down at job end to take it
with it. We mask the token in every log line that touches the URL.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import shlex
from contextlib import asynccontextmanager
from functools import partial

import httpx
from e2b import Sandbox

log = logging.getLogger(__name__)

SANDBOX_TIMEOUT_S = 300
REPO_PATH = "/home/user/repo"


# ---- GitHub token + URL helpers --------------------------------------------


def authed_clone_url(repository: str, token: str) -> str:
    """Build an `https://x-access-token:TOKEN@github.com/owner/repo.git` URL.

    GitHub treats `x-access-token` as the magic username for OAuth-style
    tokens; embedding the token in the URL lets `git clone` / `git push`
    authenticate without writing credentials to disk inside the sandbox.
    """
    return f"https://x-access-token:{token}@github.com/{repository}.git"


def mask_token(url: str) -> str:
    """Replace any `user:token@` credential in a URL with `***@` for logs."""
    return re.sub(r"://[^@/]+@", "://***@", url)


async def fetch_github_token(user_id: str) -> tuple[str, str]:
    """Call the Hono API's internal endpoint to get a plaintext token + login.

    The API decrypts the AES-GCM-encrypted token stored in `users.access_token`
    server-side. We only ever see the plaintext for the lifetime of this job.
    """
    api_url = os.environ.get("HONO_API_URL", "http://localhost:3001").rstrip("/")
    secret = os.environ.get("WORKER_SHARED_SECRET")
    if not secret:
        raise RuntimeError("WORKER_SHARED_SECRET is not set")

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{api_url}/api/internal/github-token",
            json={"userId": user_id},
            headers={"Authorization": f"Bearer {secret}"},
        )
    if resp.status_code != 200:
        raise RuntimeError(
            f"github-token endpoint returned {resp.status_code}: {resp.text}"
        )
    body = resp.json()
    return body["accessToken"], body["login"]


# ---- Sandbox wrapper -------------------------------------------------------


class WorkspaceSandbox:
    """Thin wrapper around an E2B Sandbox scoped to `REPO_PATH`.

    Exposes the small surface the agent loop needs: read (`list_dir`,
    `read_file`, `grep`), write (`write_file`, `edit_file`), and escape-hatch
    (`run_cmd`). All shell-based commands `cd` into the repo first so the
    agent thinks in repo-relative paths.
    """

    def __init__(self, sbx: Sandbox, repo_path: str = REPO_PATH) -> None:
        self._sbx = sbx
        self.sandbox_id = sbx.sandbox_id
        self.repo_path = repo_path

    # ---- internal command runner -----------------------------------------

    def _run_sync(
        self,
        cmd: str,
        timeout: int = 30,
        envs: dict[str, str] | None = None,
    ) -> tuple[int, str, str]:
        try:
            r = self._sbx.commands.run(cmd, timeout=timeout, envs=envs or {})
        except Exception as exc:  # noqa: BLE001
            return 1, "", f"[command error: {exc}]"
        return r.exit_code or 0, r.stdout or "", r.stderr or ""

    async def _run_raw(
        self,
        cmd: str,
        timeout: int = 30,
        envs: dict[str, str] | None = None,
    ) -> tuple[int, str, str]:
        return await asyncio.to_thread(self._run_sync, cmd, timeout, envs)

    async def _run(
        self,
        cmd: str,
        timeout: int = 30,
        envs: dict[str, str] | None = None,
    ) -> str:
        """Run a command and format its output for the agent."""
        code, out, err = await self._run_raw(cmd, timeout, envs)
        if code != 0:
            return f"[exit={code}] {err.strip()}\n{out}".rstrip()
        return out if out else "(no output)"

    # ---- read tools ------------------------------------------------------

    async def list_dir(self, path: str = ".") -> str:
        safe = shlex.quote(path)
        return await self._run(
            f"cd {self.repo_path} && ls -1Ap -- {safe} | head -200"
        )

    async def read_file(self, path: str, start: int = 1, end: int = 200) -> str:
        start = max(1, int(start))
        end = max(start, int(end))
        safe = shlex.quote(path)
        return await self._run(
            f"cd {self.repo_path} && sed -n '{start},{end}p' -- {safe}"
        )

    async def grep(self, pattern: str, path: str = ".") -> str:
        safe_pat = shlex.quote(pattern)
        safe_path = shlex.quote(path)
        return await self._run(
            f"cd {self.repo_path} && grep -rnIF --max-count=20 "
            f"-- {safe_pat} {safe_path} | head -100"
        )

    # ---- write tools -----------------------------------------------------

    async def write_file(self, path: str, content: str) -> str:
        """Overwrite (or create) a file with the given content.

        We base64-encode the content and decode it inside the sandbox so the
        payload is safe regardless of newlines, quotes, or binary-ish chars.
        """
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        safe_path = shlex.quote(path)
        cmd = (
            f"cd {self.repo_path} && "
            f"mkdir -p \"$(dirname -- {safe_path})\" && "
            f"printf '%s' {shlex.quote(encoded)} | base64 -d > {safe_path}"
        )
        code, _, err = await self._run_raw(cmd, timeout=30)
        if code != 0:
            return f"[write_file failed exit={code}] {err.strip()}"
        return f"wrote {path} ({len(content)} bytes)"

    async def edit_file(self, path: str, old_string: str, new_string: str) -> str:
        """Exact-string replace, à la Claude Code's `str_replace`.

        Errors out unless `old_string` appears exactly once. This forces the
        agent to disambiguate by widening the snippet rather than silently
        editing the wrong occurrence.
        """
        # Read the current contents via cat so we don't truncate at line N.
        safe_path = shlex.quote(path)
        code, current, err = await self._run_raw(
            f"cd {self.repo_path} && cat -- {safe_path}", timeout=30
        )
        if code != 0:
            return f"[edit_file failed to read exit={code}] {err.strip()}"

        occurrences = current.count(old_string)
        if occurrences == 0:
            return "[edit_file: old_string not found — widen the snippet]"
        if occurrences > 1:
            return (
                f"[edit_file: old_string appears {occurrences} times — "
                "widen the snippet to make it unique]"
            )

        updated = current.replace(old_string, new_string, 1)
        return await self.write_file(path, updated)

    async def run_cmd(self, cmd: str, timeout: int = 60) -> str:
        """Escape hatch: run an arbitrary shell command inside the repo.

        Useful for `git status`, `pnpm test`, etc. Output is truncated by
        the loop dispatcher before being sent back to the model.
        """
        return await self._run(f"cd {self.repo_path} && {cmd}", timeout=timeout)

    # ---- helpers for the orchestrator (not exposed as agent tools) -------

    async def configure_git_identity(self, name: str, email: str) -> None:
        """Set per-repo git identity so commits attribute to the user."""
        await self._run(
            f"cd {self.repo_path} && "
            f"git config user.name {shlex.quote(name)} && "
            f"git config user.email {shlex.quote(email)}"
        )

    async def has_uncommitted_changes(self) -> bool:
        code, out, _ = await self._run_raw(
            f"cd {self.repo_path} && git status --porcelain", timeout=15
        )
        return code == 0 and bool(out.strip())

    async def run_with_token(
        self, cmd: str, token: str, timeout: int = 60
    ) -> tuple[int, str, str]:
        """Run a command with `GH_TOKEN`/`GITHUB_TOKEN` in the environment.

        Used for `gh pr create` and `git push` fallbacks. Returns the raw
        (exit, stdout, stderr) tuple so the caller can decide how to react.
        """
        return await self._run_raw(
            f"cd {self.repo_path} && {cmd}",
            timeout=timeout,
            envs={"GH_TOKEN": token, "GITHUB_TOKEN": token},
        )


# ---- entry point -----------------------------------------------------------


@asynccontextmanager
async def open_sandbox(clone_url: str | None = None, repo_path: str = REPO_PATH):
    """Start a sandbox (and optionally clone a repo into it).

    `clone_url` may embed an `x-access-token` credential; we log a masked
    version. The sandbox is always killed on exit, even if cloning fails —
    that's our defense-in-depth for token containment.
    """
    if not os.environ.get("E2B_API_KEY"):
        raise RuntimeError("E2B_API_KEY is not set")

    sbx: Sandbox = await asyncio.to_thread(
        partial(Sandbox.create, timeout=SANDBOX_TIMEOUT_S)
    )
    try:
        if clone_url is not None:
            log.info(
                "e2b sandbox started id=%s, cloning %s",
                sbx.sandbox_id,
                mask_token(clone_url),
            )
            await asyncio.to_thread(
                partial(sbx.git.clone, clone_url, path=repo_path, depth=1, timeout=60)
            )
        else:
            log.info("e2b sandbox started id=%s (no clone)", sbx.sandbox_id)
        yield WorkspaceSandbox(sbx, repo_path=repo_path)
    finally:
        await asyncio.to_thread(sbx.kill)
        log.info("e2b sandbox killed id=%s", sbx.sandbox_id)
