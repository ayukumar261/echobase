from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class SessionInfo:
    repo_full_name: str
    clone_url: str
    access_token: str


class SessionResolutionError(RuntimeError):
    pass


async def resolve_session(session_id: str) -> SessionInfo:
    api_url = os.environ.get("HONO_API_URL", "http://localhost:3001").rstrip("/")
    secret = os.environ.get("PIPECAT_SHARED_SECRET")
    if not secret:
        raise SessionResolutionError("PIPECAT_SHARED_SECRET is not set")

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{api_url}/api/sessions/resolve",
            json={"sessionId": session_id},
            headers={"Authorization": f"Bearer {secret}"},
        )
    if resp.status_code != 200:
        raise SessionResolutionError(
            f"resolve failed: {resp.status_code} {resp.text[:200]}"
        )
    body = resp.json()
    return SessionInfo(
        repo_full_name=body["repoFullName"],
        clone_url=body["cloneUrl"],
        access_token=body["accessToken"],
    )
