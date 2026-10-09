.PHONY: dev dev-all demo web build test lint openapi api-client api-check infra down
GO ?= go
PNPM ?= pnpm

dev:
	$(GO) run ./cmd/server
run-dev:
	$(MAKE) --no-print-directory -j2 dev web
demo:
	$(GO) run ./cmd/demo
web:
	$(PNPM) --dir apps/web dev
build:
	$(PNPM) --dir apps/web build
	mkdir -p bin
	$(GO) build -o bin/spool ./cmd/server
	$(GO) build -o bin/spool-demo ./cmd/demo
test:
	$(GO) test ./...
	$(PNPM) --dir apps/web test
lint:
	$(GO) vet ./...
	$(PNPM) --dir apps/web lint
	$(PNPM) --dir apps/web typecheck
openapi:
	$(GO) run ./cmd/openapi
api-client: openapi
	$(PNPM) --dir apps/web api:generate
api-check:
	./scripts/api-check.sh
infra:
	docker compose up -d redis postgres prometheus
down:
	docker compose down
