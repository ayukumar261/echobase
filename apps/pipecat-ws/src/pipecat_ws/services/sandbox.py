from __future__ import annotations

import asyncio
import logging
import os
import re
import shlex
from contextlib import asynccontextmanager
from functools import partial

from e2b import Sandbox

log = logging.getLogger(__name__)

SANDBOX_TIMEOUT_S = 120
REPO_PATH = "/home/user/repo"


class RepoSandbox:
    def __init__(self, sbx: Sandbox) -> None:
        self._sbx = sbx
        self.sandbox_id = sbx.sandbox_id

    def _run_sync(self, cmd: str, timeout: int = 15) -> str:
        try:
            r = self._sbx.commands.run(cmd, timeout=timeout)
        except Exception as exc:  # noqa: BLE001
            return f"[command error: {exc}]"
        out = r.stdout or ""
        if r.exit_code != 0:
            err = (r.stderr or "").strip()
            return f"[exit={r.exit_code}] {err}\n{out}".rstrip()
        return out if out else "(no output)"

    async def _run(self, cmd: str, timeout: int = 15) -> str:
        return await asyncio.to_thread(self._run_sync, cmd, timeout)

    async def list_dir(self, path: str = ".") -> str:
        safe = shlex.quote(path)
        return await self._run(f"cd {REPO_PATH} && ls -1Ap -- {safe} | head -200")

    async def read_file(self, path: str, start: int = 1, end: int = 200) -> str:
        start = max(1, int(start))
        end = max(start, int(end))
        safe = shlex.quote(path)
        return await self._run(f"cd {REPO_PATH} && sed -n '{start},{end}p' -- {safe}")

    async def grep(self, pattern: str, path: str = ".") -> str:
        safe_pat = shlex.quote(pattern)
        safe_path = shlex.quote(path)
        return await self._run(
            f"cd {REPO_PATH} && grep -rnIF --max-count=20 "
            f"-- {safe_pat} {safe_path} | head -100"
        )


@asynccontextmanager
async def open_repo_sandbox(repo_url: str):
    if not os.environ.get("E2B_API_KEY"):
        raise RuntimeError("E2B_API_KEY is not set")

    sbx: Sandbox = await asyncio.to_thread(
        partial(Sandbox.create, timeout=SANDBOX_TIMEOUT_S)
    )
    # Mask any embedded credential before logging
    masked = re.sub(r"://[^@/]+@", "://***@", repo_url)
    log.info("e2b sandbox started id=%s, cloning %s", sbx.sandbox_id, masked)
    try:
        await asyncio.to_thread(
            partial(sbx.git.clone, repo_url, path=REPO_PATH, depth=1, timeout=60)
        )
        yield RepoSandbox(sbx)
    finally:
        await asyncio.to_thread(sbx.kill)
        log.info("e2b sandbox killed id=%s", sbx.sandbox_id)
