from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame
from pipecat.services.llm_service import FunctionCallParams

from ..config import MAX_EXECUTORS_PER_SESSION, MAX_PARALLEL_EXECUTORS
from ..models import run_executor

log = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def build_call_executor(task_holder: dict[str, PipelineTask]):
    spawned = 0
    next_id = 0
    semaphore = asyncio.Semaphore(MAX_PARALLEL_EXECUTORS)

    async def _emit(event: dict[str, Any]) -> None:
        task = task_holder.get("task")
        if task is None:
            return
        try:
            await task.queue_frames([RTVIServerMessageFrame(data=event)])
        except Exception:  # noqa: BLE001 — never let UI plumbing kill a tool call
            log.exception("fleet event emit failed")

    async def call_executor(
        params: FunctionCallParams,
        role: str,
        task: str,
        context: str = "",
    ) -> None:
        nonlocal spawned, next_id

        if spawned >= MAX_EXECUTORS_PER_SESSION:
            await params.result_callback(
                "[executor cap reached for this session — answer with what you have]",
                properties=FunctionCallResultProperties(is_final=True),
            )
            return

        spawned += 1
        executor_id = f"ex_{next_id:03d}"
        next_id += 1

        log.info("call_executor id=%s role=%s", executor_id, role)
        await _emit(
            {
                "type": "executor.spawn",
                "id": executor_id,
                "role": role,
                "task": task,
                "ts": _now_ms(),
            }
        )

        started = _now_ms()
        async with semaphore:
            result = await run_executor(role=role, task=task, context=context)
        elapsed = _now_ms() - started

        is_error = result.startswith("[executor ")
        await _emit(
            {
                "type": "executor.error" if is_error else "executor.done",
                "id": executor_id,
                **({"error": result} if is_error else {"result_preview": result[:140]}),
                "elapsed_ms": elapsed,
                "ts": _now_ms(),
            }
        )

        await params.result_callback(
            result,
            properties=FunctionCallResultProperties(is_final=True),
        )

    return call_executor
