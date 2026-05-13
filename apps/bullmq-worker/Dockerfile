FROM python:3.11-slim AS base
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

COPY pyproject.toml README.md ./
# uv.lock is optional on first build; copied if present so subsequent builds are reproducible.
COPY uv.loc[k] ./
RUN uv sync --no-install-project

FROM base AS dev
CMD ["uv", "run", "python", "-m", "bullmq_worker.main"]

FROM base AS prod
COPY src ./src
RUN uv sync
CMD ["uv", "run", "python", "-m", "bullmq_worker.main"]
