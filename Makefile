.PHONY: help dev web run-dev demo infra down build test e2e lint openapi api-client api-check
.DEFAULT_GOAL := help
GO ?= go
PNPM ?= pnpm
AIR ?= air

help: ## List available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-z0-9-]+:.*## / {printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Run the API server, rebuilding on change with Air when installed
	@if command -v $(AIR) >/dev/null 2>&1; then \
		$(AIR); \
	else \
		echo "Air not found; running without live reload. Install it with: go install github.com/air-verse/air@latest"; \
		$(GO) run ./cmd/server; \
	fi
web: ## Run the Vite dev server for the web UI
	$(PNPM) --dir apps/web dev
run-dev: ## Run the API server and web UI together
	$(MAKE) --no-print-directory -j2 dev web
demo: ## Run the demo worker, which enqueues sample traffic
	$(GO) run ./cmd/demo
infra: ## Start local Redis, PostgreSQL and Prometheus
	docker compose up -d redis postgres prometheus
down: ## Stop local infrastructure, keeping its data
	docker compose down

build: ## Build the web UI and the server and demo binaries
	$(PNPM) --dir apps/web build
	mkdir -p bin
	$(GO) build -o bin/spool ./cmd/server
	$(GO) build -o bin/spool-demo ./cmd/demo
test: ## Run backend and frontend unit tests
	$(GO) test ./...
	$(PNPM) --dir apps/web test
e2e: ## Run browser tests against isolated test databases
	$(PNPM) --dir apps/web build
	$(PNPM) --dir apps/web exec playwright test
lint: ## Run go vet, ESLint and the TypeScript checker
	$(GO) vet ./...
	$(PNPM) --dir apps/web lint
	$(PNPM) --dir apps/web typecheck

openapi: ## Regenerate api/openapi.json from the endpoint registry
	$(GO) run ./cmd/openapi
api-client: openapi ## Regenerate OpenAPI and the TypeScript client
	$(PNPM) --dir apps/web api:generate
api-check: ## Fail if the committed contract or client is out of date
	./scripts/api-check.sh
