FROM python:3.11-slim AS base
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project

FROM base AS dev
ENV PORT=8000
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "pipecat_ws.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app/src"]

FROM base AS prod
COPY src ./src
RUN uv sync --frozen
ENV PORT=8000
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "pipecat_ws.main:app", "--host", "0.0.0.0", "--port", "8000"]
