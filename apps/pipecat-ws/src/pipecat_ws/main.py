from __future__ import annotations

import logging
import os
from typing import cast

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pipecat.adapters.schemas.direct_function import DirectFunction
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMContextFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
)
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService, LiveOptions
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

from .config import ADVISOR_MODEL
from .services.session import SessionResolutionError, resolve_session
from .tools import build_call_advisor, build_call_executor, build_create_task

log = logging.getLogger(__name__)

BASE_SYSTEM_PROMPT = (
    "You are a friendly voice assistant. Your output is spoken aloud, so "
    "avoid markdown, lists, and any meta references to tools. Never speak "
    "tool names aloud — they are tools, not phrases."
    "\n\n"
    "You have two tools. Use `call_executor(role, task, context)` for "
    "breadth — call it multiple times in one turn to fan out independent "
    "sub-tasks in parallel (comparisons across items, multi-part research, "
    "plans with independent pieces). Use `call_advisor(role, task, "
    "context)` for depth — a single careful reasoning pass on one "
    "self-contained problem (weighing close trade-offs, untangling a "
    "tricky edge case). Pick the one that matches the shape of the "
    "question; you can also combine them when a question has both breadth "
    "and a hard core. For simple chitchat or quick factual answers, "
    "respond directly without calling any tool."
    "\n\n"
    "Whenever you invoke a tool, also speak a generous verbal stall "
    "in the same turn — two or three short sentences that keep the user "
    "company while the workers run. Acknowledge the question, briefly "
    "restate what you're looking into, and signal that you're thinking "
    "(e.g. 'Good question — let me weigh that for a moment. I want to look "
    "at both sides before I answer. Give me just a second.'). Vary the "
    "wording naturally; never go silent after invoking a tool. When the "
    "results return, synthesize them aloud in your own voice in two to "
    "four short, spoken-friendly sentences."
    "\n\n"
    "Once the user has converged with you on a concrete change — and only "
    "then — call `create_task(spec)` with a structured Markdown spec. The "
    "spec must have sections for Context, Files Affected, Implementation "
    "Steps, and Acceptance Criteria, and must name the actual files, "
    "functions, and edits a coding agent will make. Do not call this for "
    "chitchat, open-ended exploration, or partial ideas; gather context "
    "with executors and advisors first. The tool returns a task id; speak "
    "it aloud to the user in one short sentence (e.g. 'queued as task "
    "abc12345')."
)


def _build_system_prompt(repository: str) -> str:
    """Compose the per-session system prompt. The executor agents have
    read-only access to a clone of the user's selected repository, so the
    voice model should delegate codebase questions instead of refusing."""
    return BASE_SYSTEM_PROMPT + (
        "\n\n"
        f"A GitHub repository is connected: {repository}. "
        "Executor agents can clone it into a sandbox and explore its files "
        "(list directories, read files, search for strings). When the user "
        "asks anything about this codebase — what it does, how something is "
        "implemented, where a feature lives, what's in a directory — "
        "delegate to one or more executors with a concrete subtask. Do not "
        "claim you lack access to the code; you have access via the "
        "executors. Never read the repository URL aloud."
    )


app = FastAPI(title="pipecat-ws")

_cors_origins = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()

    session_id = ws.query_params.get("session")
    if not session_id:
        log.warning("ws connect missing session query param")
        await ws.close(code=4401)
        return
    try:
        session_info = await resolve_session(session_id)
    except SessionResolutionError as exc:
        log.warning("session resolve failed: %s", exc)
        await ws.close(code=4403)
        return

    transport = FastAPIWebsocketTransport(
        websocket=ws,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(stop_secs=0.3, start_secs=0.2, confidence=0.7),
            ),
            serializer=ProtobufFrameSerializer(),
        ),
    )

    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        live_options=LiveOptions(
            model="nova-3",
            language="en-US",
            interim_results=True,
            smart_format=True,
            punctuate=True,
            endpointing=200,
            utterance_end_ms=1000,
        ),
    )

    llm = OpenAILLMService(
        api_key=os.environ["AI_GATEWAY_API_KEY"],
        base_url="https://ai-gateway.vercel.sh/v1",
        model=ADVISOR_MODEL,
        params=OpenAILLMService.InputParams(temperature=0.6),
    )

    tts = CartesiaTTSService(
        api_key=os.environ["CARTESIA_API_KEY"],
        voice_id="71a7ad14-091c-4e8e-a314-022ece01c121",
        model="sonic-turbo",
        params=CartesiaTTSService.InputParams(language="en", speed="normal"),
    )

    task_holder: dict[str, PipelineTask] = {}
    tool_fns = [
        build_call_executor(task_holder, session_info),
        build_call_advisor(task_holder),
        build_create_task(task_holder, session_info),
    ]

    context = LLMContext(
        [
            {
                "role": "system",
                "content": _build_system_prompt(session_info.repository),
            },
            {"role": "user", "content": "Greet the user in one short sentence."},
        ],
        tools=ToolsSchema(standard_tools=[cast(DirectFunction, fn) for fn in tool_fns]),
    )
    context_aggregator = LLMContextAggregatorPair(context)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    task_holder["task"] = task
    for fn in tool_fns:
        llm.register_direct_function(
            cast(DirectFunction, fn),
            cancel_on_interruption=False,
        )

    @transport.event_handler("on_client_connected")
    async def _on_connected(_transport, _client) -> None:
        await task.queue_frames([LLMContextFrame(context=context)])

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnected(_transport, _client) -> None:
        await task.cancel()

    await PipelineRunner(handle_sigint=False).run(task)


def run() -> None:
    uvicorn.run(
        "pipecat_ws.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        reload=True,
    )


if __name__ == "__main__":
    run()
