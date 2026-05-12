# echobase

A [Turborepo](https://turborepo.com) monorepo containing a Next.js web app, a [Hono](https://hono.dev) API, and a [Pipecat](https://www.pipecat.ai) (FastAPI) voice service, backed by Postgres and Redis. The whole stack runs locally via Docker Compose, with a `Makefile` wrapping the common workflows.

## Stack

| Service       | Tech                   | Port |
| ------------- | ---------------------- | ---- |
| `next-js-app` | Next.js                | 3000 |
| `hono-api`    | Hono on Node           | 3001 |
| `pipecat`     | FastAPI + Pipecat      | 8000 |
| `postgres`    | Postgres 16 (alpine)   | 5432 |
| `redis`       | Redis 7 (alpine), AOF  | 6379 |

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2)
- `make` (preinstalled on macOS and most Linux distros)

## Quick start

```sh
make up
```

That builds the images, starts all five containers, and blocks until healthchecks pass. Then:

- Next.js → http://localhost:3000
- Hono API → http://localhost:3001
- Pipecat → http://localhost:8000

When you're done: `make down`.

## Common commands

Run `make` (no args) to see this list with colors:

| Command          | What it does                                        |
| ---------------- | --------------------------------------------------- |
| `make up`        | Build and start the full stack, wait for health     |
| `make down`      | Stop and remove containers (volumes preserved)      |
| `make reset`     | Wipe volumes and rebuild from scratch               |
| `make logs`      | Tail logs from all services                         |
| `make ps`        | Show container status and health                    |
| `make build`     | Rebuild images without starting containers          |
| `make psql`      | Open a `psql` shell in the postgres container       |
| `make redis-cli` | Open `redis-cli` in the redis container             |

## Configuration

`docker-compose.yml` reads overrides from a root `.env` file (any unset value falls back to a sensible dev default). Supported variables:

| Variable            | Default                  |
| ------------------- | ------------------------ |
| `POSTGRES_USER`     | `echobase`               |
| `POSTGRES_PASSWORD` | `echobase`               |
| `POSTGRES_DB`       | `echobase`               |
| `POSTGRES_PORT`     | `5432`                   |
| `REDIS_PORT`        | `6379`                   |
| `CORS_ORIGINS`      | `http://localhost:3000`  |

Inside the Docker network the apps reach the databases at `postgres:5432` and `redis:6379`.

## Repo layout

```
apps/
  next-js-app/   # Next.js frontend
  hono-api/      # Hono API server
  pipecat/       # FastAPI + Pipecat voice service
docker-compose.yml
Makefile
```

This is a Turborepo — see the [Turborepo docs](https://turborepo.com/docs) for details on tasks, filters, and caching across the workspace.
