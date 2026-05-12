"""FastAPI entrypoint for the Pipecat bridge server."""

from __future__ import annotations

import os

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

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

SYSTEM_PROMPT = (
    "You are a friendly voice assistant. Respond in one or two short sentences. "
    "Your output is spoken aloud, so avoid markdown or lists."
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
    """Voice agent pipeline: Deepgram STT -> Vercel AI Gateway LLM -> Cartesia TTS."""
    await ws.accept()

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
        model="minimax/minimax-m2.7-highspeed",
        params=OpenAILLMService.InputParams(temperature=0.6, max_tokens=120),
    )

    tts = CartesiaTTSService(
        api_key=os.environ["CARTESIA_API_KEY"],
        voice_id="71a7ad14-091c-4e8e-a314-022ece01c121",
        model="sonic-turbo",
        params=CartesiaTTSService.InputParams(language="en", speed="normal"),
    )

    # Seed a `user` turn so the very first LLM call has something to respond to.
    # The Vercel AI Gateway / minimax provider rejects requests with only a
    # system message (error 2013: "messages must not be empty").
    context = LLMContext(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "Greet the user in one short sentence."},
        ]
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

    @transport.event_handler("on_client_connected")
    async def _on_connected(_transport, _client) -> None:
        await task.queue_frames([LLMContextFrame(context=context)])

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnected(_transport, _client) -> None:
        await task.cancel()

    await PipelineRunner(handle_sigint=False).run(task)


def run() -> None:
    """Run the dev server. Used by the `pipecat-ws` console script."""
    uvicorn.run(
        "pipecat_ws.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        reload=True,
    )


if __name__ == "__main__":
    run()
