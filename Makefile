# Modex Apply.
#
# The target that matters is `make dev`: a new developer clones, runs it, and
# reaches a working web + API + database + queue + storage stack in under
# fifteen minutes (Phase 0 acceptance criteria).

SHELL := /bin/bash
.DEFAULT_GOAL := help
COMPOSE ?= docker compose

# The integration suite truncates, so it never touches the development database.
TEST_DATABASE_URL ?= postgresql://modex:modex@localhost:5432/modex_test

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install workspace dependencies
	pnpm install

.PHONY: services
services: ## Start postgres, redis and minio
	$(COMPOSE) up -d --wait

.PHONY: migrate
migrate: ## Apply database migrations
	pnpm --filter @modex/api prisma:migrate

.PHONY: seed
seed: ## Load development fixtures and build the search index
	pnpm --filter @modex/api seed
	pnpm --filter @modex/api reindex

.PHONY: dev
dev: install services ## Clean clone to a running stack
	@test -f .env || cp .env.example .env
	$(MAKE) migrate
	$(MAKE) seed
	pnpm dev

.PHONY: build
build: ## Build every package and app
	pnpm build

.PHONY: test
test: ## Unit tests across the workspace
	pnpm test

.PHONY: test-integration
test-integration: services ## Integration tests against a real database
	# Pinned to `modex_test`, not inherited. The suite truncates between tests,
	# so a sourced `.env` pointing at the development database would empty it
	# and take the seed with it.
	DATABASE_URL=$(TEST_DATABASE_URL) pnpm --filter @modex/api prisma:migrate
	DATABASE_URL=$(TEST_DATABASE_URL) pnpm --filter @modex/api test:integration

.PHONY: test-e2e
test-e2e: ## Browser journeys and accessibility, against a running stack
	pnpm --filter @modex/web test:e2e

.PHONY: verify
verify: ## Everything CI runs
	pnpm verify

.PHONY: down
down: ## Stop services
	$(COMPOSE) down

.PHONY: clean
clean: ## Stop services and remove volumes
	$(COMPOSE) down -v
