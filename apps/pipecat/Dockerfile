FROM python:3.11-slim
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --frozen

ENV PORT=8000
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "pipecat.main:app", "--host", "0.0.0.0", "--port", "8000"]
