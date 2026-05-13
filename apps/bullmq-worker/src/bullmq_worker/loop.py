"""Coding agent loop on top of the Vercel AI Gateway + an E2B sandbox.

The model gets the user's implementation spec as system context and a small
Claude Code-style toolset: `list_dir`, `read_file`, `grep`, `write_file`,
`edit_file`, `run_cmd`, and `finish`. When the model is satisfied it calls
`finish(branch_name, pr_title, pr_body, summary)` — the orchestrator in
`main.py` reads that envelope and handles commit/push/PR creation.

`finish` is the loop's only exit; if `MAX_LOOP_STEPS` runs out we return a
sentinel envelope so the orchestrator can skip the push and report failure.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass

from openai import AsyncOpenAI
from openai.types.chat import (
    ChatCompletionMessageFunctionToolCall,
    ChatCompletionMessageParam,
    ChatCompletionToolParam,
)

from .sandbox import WorkspaceSandbox

log = logging.getLogger(__name__)

GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"

# Tool results sent back to the model are capped so a runaway `run_cmd` or
# huge file can't blow the context window.
TOOL_RESULT_MAX_CHARS = 8000

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=os.environ["AI_GATEWAY_API_KEY"],
            base_url=GATEWAY_BASE_URL,
        )
    return _client


@dataclass
class FinishEnvelope:
    """What the model hands back when it calls `finish`."""

    branch_name: str
    pr_title: str
    pr_body: str
    summary: str
    completed: bool  # False = loop exhausted / never finished


AGENT_TOOLS: list[ChatCompletionToolParam] = [
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List entries in a directory under the repo root. Use '.' for the repo root.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory path, relative to repo root."}
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a line range from a file. Prefer narrow ranges (default 200 lines).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path, relative to repo root."},
                    "start": {"type": "integer", "description": "First line (1-indexed)."},
                    "end": {"type": "integer", "description": "Last line inclusive."},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grep",
            "description": "Fixed-string recursive search across the repo. Returns up to ~100 matching lines.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Literal string to search for."},
                    "path": {"type": "string", "description": "Directory or file. Default '.'."},
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Create or overwrite a file with the given content. Use for new files; "
                "for edits to existing files, prefer `edit_file` so you don't clobber "
                "unrelated content."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path, relative to repo root."},
                    "content": {"type": "string", "description": "Full file contents."},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                "Replace one occurrence of `old_string` with `new_string` in a file. "
                "`old_string` MUST appear exactly once — include enough surrounding "
                "context to make it unique."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path, relative to repo root."},
                    "old_string": {"type": "string", "description": "Exact text to replace (must be unique)."},
                    "new_string": {"type": "string", "description": "Replacement text."},
                },
                "required": ["path", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_cmd",
            "description": (
                "Run a shell command from the repo root. Use sparingly — for things "
                "like `git status`, `git diff`, or running a test. Output is truncated."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cmd": {"type": "string", "description": "Shell command to run."},
                    "timeout": {"type": "integer", "description": "Seconds (default 60)."},
                },
                "required": ["cmd"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": (
                "Call once your changes are staged on disk. Provides the branch, PR "
                "title, PR body, and a short human-readable summary. The orchestrator "
                "will commit, push, and open the draft PR."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "branch_name": {
                        "type": "string",
                        "description": "New branch name, e.g. `agent/add-contributing`.",
                    },
                    "pr_title": {"type": "string", "description": "PR title (single line)."},
                    "pr_body": {"type": "string", "description": "PR body (markdown)."},
                    "summary": {
                        "type": "string",
                        "description": "Short summary of what you did, for the job result.",
                    },
                },
                "required": ["branch_name", "pr_title", "pr_body", "summary"],
            },
        },
    },
]


SYSTEM_PROMPT_TEMPLATE = """You are a coding agent operating on a freshly cloned GitHub repository.

The repository `{repository}` is checked out at `/home/user/repo`; all tool paths are repo-relative. The base branch is `{base_branch}`.

Your job:
1. Read the implementation spec below.
2. Investigate the repo (`list_dir`, `read_file`, `grep`) so your changes match existing conventions.
3. Apply small, focused edits with `edit_file` (prefer) and `write_file` (for new files).
4. When done, call `finish` with a branch name, PR title, PR body, and a one-paragraph summary. Do NOT commit, push, or open the PR yourself — the orchestrator handles that.

Rules:
- Don't speculate when you can look. Read the file before editing it.
- `edit_file` requires a UNIQUE `old_string`; widen the snippet if a replace fails.
- Keep diffs minimal; do not reformat unrelated code.
- Choose a branch name in `kebab-case`, prefixed `agent/`.
"""


def _truncate(s: str, limit: int = TOOL_RESULT_MAX_CHARS) -> str:
    if len(s) <= limit:
        return s
    return s[:limit] + f"\n…[truncated {len(s) - limit} chars]"


async def _dispatch(sbx: WorkspaceSandbox, name: str, raw_args: str) -> str:
    try:
        args = json.loads(raw_args or "{}")
    except json.JSONDecodeError as exc:
        return f"[bad tool arguments: {exc}]"
    method = getattr(sbx, name, None)
    if method is None or name in {"configure_git_identity", "run_with_token"}:
        # Defensive: only expose the documented agent tools, never the
        # orchestrator-only helpers on WorkspaceSandbox.
        return f"[unknown tool: {name}]"
    try:
        result = await method(**args)
    except TypeError as exc:
        return f"[bad tool arguments: {exc}]"
    except Exception as exc:  # noqa: BLE001
        log.exception("tool %s failed", name)
        return f"[tool error: {exc}]"
    return _truncate(str(result))


async def run_agent_loop(
    spec: str,
    sbx: WorkspaceSandbox,
    *,
    repository: str,
    base_branch: str,
) -> FinishEnvelope:
    """Drive the model through tool calls until it calls `finish` (or we cap out)."""
    client = _get_client()
    model = os.environ.get("MODEL", "anthropic/claude-opus-4-7")
    max_steps = int(os.environ.get("MAX_LOOP_STEPS", "20"))

    system = SYSTEM_PROMPT_TEMPLATE.format(
        repository=repository, base_branch=base_branch
    )
    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": f"{system}\n\n## Implementation Spec\n\n{spec}"},
        {
            "role": "user",
            "content": "Begin. Investigate the repo, make the change, then call `finish`.",
        },
    ]

    for step in range(max_steps):
        resp = await client.chat.completions.create(
            model=model,
            messages=messages,
            tools=AGENT_TOOLS,
            temperature=0.3,
            max_tokens=1500,
        )
        msg = resp.choices[0].message
        tool_calls = [
            tc
            for tc in (msg.tool_calls or [])
            if isinstance(tc, ChatCompletionMessageFunctionToolCall)
        ]

        if not tool_calls:
            # Model gave up without calling finish — treat as non-completion.
            return FinishEnvelope(
                branch_name="",
                pr_title="",
                pr_body="",
                summary=(msg.content or "").strip()
                or "[agent stopped without calling finish]",
                completed=False,
            )

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

        # If `finish` is in this batch, short-circuit. The model may call other
        # tools in the same batch; we ignore them — finish is terminal.
        for tc in tool_calls:
            if tc.function.name == "finish":
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                return FinishEnvelope(
                    branch_name=str(args.get("branch_name", "")).strip(),
                    pr_title=str(args.get("pr_title", "")).strip(),
                    pr_body=str(args.get("pr_body", "")),
                    summary=str(args.get("summary", "")).strip(),
                    completed=True,
                )

        results = await asyncio.gather(
            *(_dispatch(sbx, tc.function.name, tc.function.arguments) for tc in tool_calls)
        )
        for tc, result in zip(tool_calls, results, strict=True):
            log.info("tool step=%d name=%s", step, tc.function.name)
            messages.append(
                {"role": "tool", "tool_call_id": tc.id, "content": result}
            )

    return FinishEnvelope(
        branch_name="",
        pr_title="",
        pr_body="",
        summary=f"[loop exhausted after {max_steps} steps]",
        completed=False,
    )
