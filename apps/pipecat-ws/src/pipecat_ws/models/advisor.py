from __future__ import annotations

import asyncio
import logging
import os

from openai import AsyncOpenAI

from ..config import (
    ADVISOR_MODEL,
    ADVISOR_TIMEOUT_S,
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


async def run_advisor(role: str, task: str, context: str = "") -> str:
    system = (
        f"You are a {role}. Reason carefully about the task you're given. "
        "Weigh trade-offs, consider edge cases, and produce a clear, "
        "well-justified answer. Return only the result — no preamble, no "
        "meta-commentary."
    )
    user = task if not context else f"Context:\n{context}\n\nTask:\n{task}"

    client = _get_client()
    try:
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=ADVISOR_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.5,
                max_tokens=800,
            ),
            timeout=ADVISOR_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        log.warning("advisor timeout role=%s", role)
        return f"[advisor timed out after {ADVISOR_TIMEOUT_S}s]"
    except Exception as exc:  # noqa: BLE001 — surface to caller as a string
        log.exception("advisor failed role=%s", role)
        return f"[advisor error: {exc}]"

    return (resp.choices[0].message.content or "").strip()
