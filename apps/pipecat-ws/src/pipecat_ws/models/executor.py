from __future__ import annotations

import asyncio
import logging
import os

from openai import AsyncOpenAI

from ..config import (
    EXECUTOR_MODEL,
    EXECUTOR_TIMEOUT_S,
    GATEWAY_BASE_URL,
)

log = logging.getLogger(__name__)


_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=os.environ["AI_GATEWAY_API_KEY"],
            base_url=GATEWAY_BASE_URL,
        )
    return _client


async def run_executor(role: str, task: str, context: str = "") -> str:
    user = task if not context else f"Context:\n{context}\n\nTask:\n{task}"

    client = _get_client()
    try:
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=EXECUTOR_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.4,
                max_tokens=400,
            ),
            timeout=EXECUTOR_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        log.warning("executor timeout role=%s", role)
        return f"[executor timed out after {EXECUTOR_TIMEOUT_S}s]"
    except Exception as exc:  # noqa: BLE001 — surface to advisor as a string
        log.exception("executor failed role=%s", role)
        return f"[executor error: {exc}]"

    return (resp.choices[0].message.content or "").strip()
