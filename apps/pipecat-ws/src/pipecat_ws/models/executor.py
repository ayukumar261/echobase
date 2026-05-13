from __future__ import annotations

import asyncio
import json
import logging
import os

from openai import AsyncOpenAI
from openai.types.chat import (
    ChatCompletionMessageFunctionToolCall,
    ChatCompletionMessageParam,
    ChatCompletionToolParam,
)

from ..config import (
    EXECUTOR_MODEL,
    EXECUTOR_TIMEOUT_S,
    GATEWAY_BASE_URL,
)
from ..services.sandbox import RepoSandbox, open_repo_sandbox
from ..services.session import SessionInfo

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


# OpenAI-format tool schemas exposed to the executor LLM. The names match
# methods on RepoSandbox so dispatch is just getattr.
RESEARCH_TOOLS: list[ChatCompletionToolParam] = [
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List entries in a directory of the cloned repo. Use '.' for the repo root.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path relative to repo root.",
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a line range from a file in the cloned repo. Prefer narrow ranges.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to repo root.",
                    },
                    "start": {
                        "type": "integer",
                        "description": "First line (1-indexed). Default 1.",
                    },
                    "end": {
                        "type": "integer",
                        "description": "Last line inclusive. Default 200.",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grep",
            "description": "Fixed-string recursive search through the repo. Returns up to ~100 matching lines.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Literal string to search for.",
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory or file to search. Default '.'.",
                    },
                },
                "required": ["pattern"],
            },
        },
    },
]


def _system_prompt(role: str, repo_url: str) -> str:
    return (
        f"You are a {role} executor agent. An advisor has handed you a focused "
        "subtask. Answer it concisely and concretely — return only the result, "
        "no preamble, no meta-commentary."
        f"\n\nYou have read-only access to a cloned copy of {repo_url} via "
        "the list_dir, read_file, and grep tools. Use them to ground your "
        "answer in actual code. Don't speculate when you can look."
    )


async def _dispatch_tool_call(repo: RepoSandbox, name: str, raw_args: str) -> str:
    try:
        args = json.loads(raw_args or "{}")
    except json.JSONDecodeError as exc:
        return f"[bad tool arguments: {exc}]"
    method = getattr(repo, name, None)
    if method is None:
        return f"[unknown tool: {name}]"
    try:
        return await method(**args)
    except TypeError as exc:
        return f"[bad tool arguments: {exc}]"
    except Exception as exc:  # noqa: BLE001
        log.exception("tool %s failed", name)
        return f"[tool error: {exc}]"


async def _run_research_loop(repo: RepoSandbox, system: str, user: str) -> str:
    client = _get_client()
    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    step = 0
    while True:
        resp = await client.chat.completions.create(
            model=EXECUTOR_MODEL,
            messages=messages,
            tools=RESEARCH_TOOLS,
            temperature=0.4,
            max_tokens=600,
        )
        msg = resp.choices[0].message
        # Custom tool calls aren't part of our schema — only function calls
        # can be dispatched, so drop anything else defensively.
        tool_calls = [
            tc
            for tc in (msg.tool_calls or [])
            if isinstance(tc, ChatCompletionMessageFunctionToolCall)
        ]

        if not tool_calls:
            return (msg.content or "").strip()

        # Keep the assistant turn (with its tool_calls) before appending results.
        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ],
            }
        )

        # Run tool calls concurrently — they're independent shell commands.
        results = await asyncio.gather(
            *(
                _dispatch_tool_call(repo, tc.function.name, tc.function.arguments)
                for tc in tool_calls
            )
        )
        for tc, result in zip(tool_calls, results, strict=True):
            log.info("tool step=%d name=%s", step, tc.function.name)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                }
            )
        step += 1


def _authed_clone_url(session: SessionInfo) -> str:
    prefix = "https://"
    if not session.clone_url.startswith(prefix):
        return session.clone_url
    return f"{prefix}x-access-token:{session.access_token}@{session.clone_url[len(prefix) :]}"


async def run_executor(
    role: str,
    task: str,
    context: str = "",
    *,
    session: SessionInfo,
) -> str:
    user = task if not context else f"Context:\n{context}\n\nTask:\n{task}"
    system = _system_prompt(role, session.repository)
    clone_url = _authed_clone_url(session)

    try:
        async with open_repo_sandbox(clone_url) as repo:
            return await asyncio.wait_for(
                _run_research_loop(repo, system, user),
                timeout=EXECUTOR_TIMEOUT_S,
            )
    except asyncio.TimeoutError:
        log.warning("executor timeout role=%s", role)
        return f"[executor timed out after {EXECUTOR_TIMEOUT_S}s]"
    except Exception as exc:  # noqa: BLE001 — surface to advisor as a string
        log.exception("executor failed role=%s", role)
        return f"[executor error: {exc}]"
