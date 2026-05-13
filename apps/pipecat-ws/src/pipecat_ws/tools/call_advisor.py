from __future__ import annotations

import logging
import time
from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame
from pipecat.services.llm_service import FunctionCallParams

from ..models import run_advisor

log = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def build_call_advisor(task_holder: dict[str, PipelineTask]):
    next_id = 0

    async def _emit(event: dict[str, Any]) -> None:
        task = task_holder.get("task")
        if task is None:
            return
        try:
            await task.queue_frames([RTVIServerMessageFrame(data=event)])
        except Exception:  # noqa: BLE001 — never let UI plumbing kill a tool call
            log.exception("fleet event emit failed")

    async def call_advisor(
        params: FunctionCallParams,
        role: str,
        task: str,
        context: str = "",
    ) -> None:
        nonlocal next_id

        advisor_id = f"ad_{next_id:03d}"
        next_id += 1

        log.info("call_advisor id=%s role=%s", advisor_id, role)
        await _emit(
            {
                "type": "advisor.spawn",
                "id": advisor_id,
                "role": role,
                "task": task,
                "ts": _now_ms(),
            }
        )

        started = _now_ms()
        result = await run_advisor(role=role, task=task, context=context)
        elapsed = _now_ms() - started

        is_error = result.startswith("[advisor ")
        await _emit(
            {
                "type": "advisor.error" if is_error else "advisor.done",
                "id": advisor_id,
                **({"error": result} if is_error else {"result_preview": result[:140]}),
                "elapsed_ms": elapsed,
                "ts": _now_ms(),
            }
        )

        await params.result_callback(
            result,
            properties=FunctionCallResultProperties(is_final=True),
        )

    return call_advisor
