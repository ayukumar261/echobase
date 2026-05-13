from __future__ import annotations

import logging
import os
import time
from typing import Any

import httpx
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame
from pipecat.services.llm_service import FunctionCallParams

from ..services.session import SessionInfo

log = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def build_create_task(
    task_holder: dict[str, PipelineTask],
    session_info: SessionInfo,
):
    async def _emit(event: dict[str, Any]) -> None:
        task = task_holder.get("task")
        if task is None:
            return
        try:
            await task.queue_frames([RTVIServerMessageFrame(data=event)])
        except Exception:  # noqa: BLE001
            log.exception("fleet event emit failed")

    async def create_task(params: FunctionCallParams, spec: str) -> None:
        """Persist a finished Markdown implementation spec and enqueue it for
        execution. Call this only once you have a concrete, complete spec —
        naming files, functions, and steps. Returns the queued task id."""
        api_url = os.environ.get("HONO_API_URL", "http://localhost:3001").rstrip("/")

        try:
            async with httpx.AsyncClient(
                timeout=15.0,
                cookies={"user_id": session_info.user_id},
            ) as client:
                resp = await client.post(
                    f"{api_url}/api/tasks",
                    json={
                        "task": spec,
                        # The coding agent needs to know which repo to clone +
                        # PR against. The session already carries this from
                        # when the user picked it in the workflow UI.
                        "repository": session_info.repository,
                    },
                )
        except Exception as exc:  # noqa: BLE001
            log.exception("create_task POST failed")
            await _emit({"type": "task.error", "error": str(exc), "ts": _now_ms()})
            await params.result_callback(
                f"[create_task error] {exc}",
                properties=FunctionCallResultProperties(is_final=True),
            )
            return

        if resp.status_code != 201:
            err = f"{resp.status_code} {resp.text[:200]}"
            log.warning("create_task non-201: %s", err)
            await _emit({"type": "task.error", "error": err, "ts": _now_ms()})
            await params.result_callback(
                f"[create_task error] {err}",
                properties=FunctionCallResultProperties(is_final=True),
            )
            return

        body = resp.json()
        task_id = body.get("id", "")
        log.info("create_task queued id=%s", task_id)
        await _emit({"type": "task.created", "id": task_id, "ts": _now_ms()})
        await params.result_callback(
            f"Task queued: {task_id}",
            properties=FunctionCallResultProperties(is_final=True),
        )

    return create_task
