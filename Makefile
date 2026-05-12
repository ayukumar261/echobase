.DEFAULT_GOAL := help
.PHONY: help up down reset logs ps build psql redis-cli

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "; printf "Usage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Build and start the full stack, waiting for healthchecks
	docker compose up -d --build --wait

down: ## Stop and remove containers (volumes preserved)
	docker compose down

reset: ## Wipe volumes and rebuild from scratch
	docker compose down -v && docker compose up -d --build --wait

logs: ## Tail logs from all services
	docker compose logs -f

ps: ## Show container status and health
	docker compose ps

build: ## Rebuild images without starting containers
	docker compose build

psql: ## Open a psql shell in the postgres container
	docker compose exec postgres psql -U echobase -d echobase

redis-cli: ## Open redis-cli in the redis container
	docker compose exec redis redis-cli
