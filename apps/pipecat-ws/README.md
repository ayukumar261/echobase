# pipecat-ws

FastAPI server that bridges the echobase frontend to a Pipecat pipeline.

Managed with [`uv`](https://docs.astral.sh/uv/).

## Quickstart

```bash
cd apps/pipecat-ws
uv sync
uv run uvicorn pipecat_ws.main:app --reload --port 8000
# or, equivalently:
uv run pipecat-ws
```

Health check:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed.

| Var            | Default                  | Notes                                 |
| -------------- | ------------------------ | ------------------------------------- |
| `PORT`         | `8000`                   | Server port                           |
| `CORS_ORIGINS` | `http://localhost:3000`  | Comma-separated allowed origins       |

## Monorepo note

This app lives under `apps/` for colocation only — it is **not** a pnpm
workspace member and is intentionally outside the Turbo pipeline. Run it
directly with `uv` from this directory.
