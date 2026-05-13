# bullmq-worker

Python worker that consumes jobs from the `tasks` BullMQ queue produced by `apps/hono-api`. Currently a starting point — it prints each job and marks it complete.

## Run locally

```sh
cp .env.example .env
uv sync
uv run python -m bullmq_worker.main
```

## Run via Docker Compose

```sh
docker compose up -d bullmq-worker
docker compose logs -f bullmq-worker
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `REDIS_URL` | _(required)_ | Redis connection URL, e.g. `redis://localhost:6379`. |
| `QUEUE_NAME` | `tasks` | BullMQ queue to consume. |
| `WORKER_CONCURRENCY` | `1` | Number of jobs to process concurrently. |
