.PHONY: help install self-host test-install dev web run-dev demo infra down build image image-bundled test e2e lint openapi api-client api-check
.DEFAULT_GOAL := help
GO ?= go
PNPM ?= pnpm
AIR ?= air
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null | sed 's/^v//' || echo dev)
LDFLAGS := -s -w -X github.com/nanaaikinson/spool/internal/version.Version=$(VERSION)

help: ## List available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-z0-9-]+:.*## / {printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install web UI dependencies at the pinned pnpm version
	cd apps/web && $(PNPM) install --frozen-lockfile
self-host: ## Guided self-hosted setup with optional bundled Prometheus
	./scripts/install.sh
test-install: ## Check self-hosted setup and Compose configuration without starting containers
	python3 scripts/test-install.py
dev: ## Run the API server, rebuilding on change with Air when installed
	@if command -v $(AIR) >/dev/null 2>&1; then \
		$(AIR); \
	else \
		echo "Air not found; running without live reload. Install it with: go install github.com/air-verse/air@latest"; \
		$(GO) run ./cmd/server; \
	fi
web: ## Run the Vite dev server for the web UI
	cd apps/web && $(PNPM) dev
run-dev: ## Run the API server and web UI together
	$(MAKE) --no-print-directory -j2 dev web
demo: ## Run the demo worker, which enqueues sample traffic
	$(GO) run ./cmd/demo
infra: ## Start local Redis and Prometheus
	docker compose up -d redis prometheus
down: ## Stop local infrastructure, keeping its data
	docker compose down

build: ## Build the web UI and the server and demo binaries
	cd apps/web && $(PNPM) build
	mkdir -p bin
	$(GO) build -trimpath -ldflags "$(LDFLAGS)" -o bin/spool ./cmd/server
	$(GO) build -trimpath -ldflags "$(LDFLAGS)" -o bin/spool-demo ./cmd/demo
image: ## Build the Docker image locally, tagged spool:$(VERSION)
	docker build --build-arg VERSION=$(VERSION) -t spool:$(VERSION) .
image-bundled: ## Build the image with a private Prometheus, tagged spool:VERSION-bundled
	docker build --target bundled --build-arg VERSION=$(VERSION) -t spool:$(VERSION)-bundled .
test: ## Run backend and frontend unit tests
	$(GO) test ./...
	cd apps/web && $(PNPM) test
e2e: ## Run browser tests against an isolated Redis database
	cd apps/web && $(PNPM) build
	cd apps/web && $(PNPM) exec playwright test
lint: ## Run go vet, ESLint and the TypeScript checker
	$(GO) vet ./...
	cd apps/web && $(PNPM) lint
	cd apps/web && $(PNPM) typecheck

openapi: ## Regenerate api/openapi.json from the endpoint registry
	$(GO) run ./cmd/openapi
api-client: openapi ## Regenerate OpenAPI and the TypeScript client
	cd apps/web && $(PNPM) api:generate
api-check: ## Fail if the committed contract or client is out of date
	./scripts/api-check.sh
