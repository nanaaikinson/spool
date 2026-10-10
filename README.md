# Spool

A self-hosted observability and operations console for Asynq. React, TypeScript and Vite on the frontend; Go, Chi and the Asynq Inspector on the backend. PostgreSQL stores the audit log, saved views and periodic schedule links; it does not mirror tasks.

What Spool shows:

- **Dashboard**: needs-attention checks (no running servers, queues no server processes, paused queues, long waits, high failure rates, archived growth, servers at capacity, overdue schedules) and the top error groups.
- **Live activity**: tasks processing right now, what runs next, and a running tail of started and finished tasks.
- **Metrics**: historical Prometheus charts with a live mode.
- **Queues**, **All tasks**, **Scheduled** and **Failed** views, with payload and error inspection, retry/archive/delete/cancel/clone actions where the task state allows them, confirmed bulk actions, and saved views.
- **Servers**: each Asynq server process, its queues and its busy worker slots.
- **Periodic schedules**: cron specs with plain-English descriptions. Tasks link back to the schedule entry that enqueued them, and those links are kept in PostgreSQL after Asynq drops its enqueue history.
- **Settings & audit log**, a command palette, dark and light themes, and admin/viewer accounts.

## Quick start

Requires Go 1.27+, Node 24+, pnpm 10.33 (pinned in `package.json`), and Docker Compose. [Air](https://github.com/air-verse/air) is optional: `make dev` uses it for live reload when installed and falls back to `go run` otherwise. With Corepack, run `corepack enable` once before installing dependencies.

```sh
cp .env.example .env
pnpm --dir apps/web install --frozen-lockfile
make infra
make run-dev
```

`make run-dev` runs the Go server and Vite together in one terminal; press Ctrl+C to stop both. Run them separately with `make dev` and `make web`. Environment overrides such as `REDIS_URL=redis://YOUR_REDIS_HOST:6379/0 make run-dev` apply to both.

Open http://127.0.0.1:5173. To generate realistic traffic in the dedicated local Redis container, use another terminal:

```sh
REDIS_URL=redis://127.0.0.1:6388/0 make demo
```

The demo runs an Asynq server and enqueues successful emails, slow reports, scheduled reports, billing failures and webhook retries that eventually archive. It also registers a periodic schedule. Stop it with Ctrl+C. Always point the demo at a dedicated Redis database, never at production; it refuses to start without an explicit `REDIS_URL`.

Local infrastructure ports are Redis **6388**, PostgreSQL **5448**, Prometheus **9098** and the API **8088**. Connections use explicit IPv4 loopback addresses to avoid unrelated services listening on localhost. Set different ports and URLs if these are occupied. `make down` stops this project's infrastructure without deleting its volumes.

## Container evaluation

```sh
docker compose up --build -d
# Optional synthetic traffic, in this project's Redis container:
docker compose --profile demo up -d demo
```

Open http://127.0.0.1:8088. The development Compose account is `admin` / `spool-local`. Compose runs all infrastructure plus a non-root Go container that serves the built UI. Its example passwords and signing key are for local evaluation; set real secrets for production. The Prometheus scrape file targets `host.docker.internal:8088`, which works for both native development and the published application container port. Inside a production network, use the application's service name and internal port.

## Production deployment

| Dependencies | Compose file | Environment template |
| --- | --- | --- |
| Your Redis + bundled PostgreSQL | [compose.production.redis.yaml](compose.production.redis.yaml) | [.env.production.redis.example](.env.production.redis.example) |
| Your Redis + your PostgreSQL | [compose.production.external.yaml](compose.production.external.yaml) | [.env.production.external.example](.env.production.external.example) |

Both build the root Dockerfile, require production credentials, and expose port 8080 only to the container network. The optional [host override](compose.production.host.yaml) publishes it on loopback for a host-installed HTTPS proxy.

See the [production deployment guide](docs/deployment.md) for exact commands, Dokploy/Coolify settings, Dockerfile-only hosting, connection URLs, HTTPS, metrics routing, and persistent storage.

## Configuration

The server loads `.env` when present without overriding process environment variables. Infrastructure URLs never reach the browser.

| Variable | Purpose | Default |
| --- | --- | --- |
| `SPOOL_ADDR` | HTTP listen address | `127.0.0.1:8088` |
| `REDIS_URL` | Asynq connection URI, including DB index | `redis://127.0.0.1:6388/0` |
| `DATABASE_URL` | PostgreSQL URI for the audit log, saved views and schedule links | unset |
| `PROMETHEUS_URL` | Prometheus base URL, with optional URI credentials | unset |
| `SPOOL_ENV` | Environment label | `development` |
| `SPOOL_STATIC_DIR` | Compiled frontend directory | `apps/web/dist` |
| `SPOOL_READ_ONLY` | Disable all changes, even for the admin account | `false` |
| `SPOOL_ADMIN_USER`, `SPOOL_ADMIN_PASSWORD` | Operations account | unset |
| `SPOOL_VIEWER_USER`, `SPOOL_VIEWER_PASSWORD` | Read-only account | unset |
| `SPOOL_SESSION_KEY` | Session signing secret; at least 32 characters when accounts are set | unset |
| `SPOOL_SECURE_COOKIE` | HTTPS-only session cookie | `false` |

Accounts are required when `SPOOL_ADDR` is not a loopback address. Use long random account passwords, a random signing secret, TLS termination, and `SPOOL_SECURE_COOKIE=true` in production. Protect Redis and PostgreSQL with their own network and credentials. Expose `/metrics` only to the monitoring network; exclude it from public ingress. Stateless signed sessions expire after 12 hours. Changing the signing key revokes all sessions; logout deletes the browser cookie. Spool supports a configured admin and viewer account, not a multi-user identity-management system.

Without PostgreSQL, viewing works but every change is refused before it reaches Redis, and task-to-schedule links last only as long as Asynq keeps its enqueue history. Migrations run under an advisory lock at startup. Each change is written to the audit log as pending before the Redis action and marked succeeded or failed afterward, so a record left pending (for example after a crash) means the outcome is unknown. Payloads are never stored in the audit log. Back up PostgreSQL and retain audit records as your deployment requires.

`/health` checks the running process; `/ready` checks Redis and, when configured, PostgreSQL. Prometheus is optional and does not block readiness. Structured logs include request IDs, route templates, statuses and timings. `/metrics` exports native Asynq metrics, Go/process metrics and `spool_http_request_duration_seconds`.

## Data limits

Task lists read a single Asynq page per request, with at most 100 tasks. Type, minimum retry and failure-time filters apply to that page; use the next cursor even when a filtered page is empty. Queue plus exact task ID performs a direct lookup. State totals are before page filters. There is no Redis-wide payload scan. Aggregating tasks require a group name and are excluded from unscoped collections. Changing task state while paging can shift records, as with Asynq's own page APIs.

Queue priority is configured per server, so it appears on the Servers page. Processed counters include failed attempts. Success rate subtracts failures from processed attempts. Stored completed task counts are distinct from processed totals. Native `asynq_tasks_enqueued_total` is a state gauge despite its name; Spool does not present it as cumulative enqueue throughput.

Task details display only retained timestamps, the last error and retry count. The Asynq Inspector does not expose a full attempt history or enqueue, creation or heartbeat timestamps. Orphaned tasks use Asynq's explicit orphan indication. Cancel is best effort: it requires exactly one running worker for the task and sends Asynq's cancellation signal. Clone creates a new task with explicit queue/type/payload/retry settings and 24-hour retention; it does not restore the original uniqueness or scheduling options. Binary and truncated payloads cannot be cloned from their displayed form. Payload/result display is bounded at 256 KiB; binary data is base64.

Historical charts use Prometheus range queries against the Asynq metrics collector and refresh every minute while visible, or every 15 seconds in live mode. The API allows a fixed metric set, ranges up to seven days and at most 1500 points per series. Spool does not fabricate history it never recorded. A single server-sent events (SSE) broker tells the UI to refetch every 15 seconds and immediately after each change; the broker itself does not poll Redis.

## Development and checks

Run `make` on its own to list every target.

```sh
make api-client    # Generate and validate OpenAPI, then generate Hey API client/query helpers
make api-check     # Regenerate and compare the canonical contract and committed client
make lint          # go vet, ESLint, TypeScript
make test          # Backend and frontend unit tests
make build         # Build the web UI and the Go server and demo binaries
make e2e           # Build the web UI and run the Playwright browser tests
pnpm --dir apps/web exec prettier --write src e2e '*.ts'
```

Real integration tests use explicitly configured isolated services:

```sh
SPOOL_TEST_REDIS=redis://127.0.0.1:6388/15 \
SPOOL_TEST_DATABASE='postgres://spool:spool-local@127.0.0.1:5448/spool?sslmode=disable' \
go test -race ./internal/...

pnpm --dir apps/web exec playwright install chromium
make e2e
```

Playwright seeds only the `spool-e2e` queue in Redis database 15, starts isolated API instances on ports 8188/8189 and Vite on 5188, then tests themes, persistence, queue status tabs, task navigation, scheduled summaries, advanced filters, archive/retry, failures, a command palette, non-JSON payloads, mobile layout, session roles and saved-view creation/restoration/deletion. It also verifies shadcn Select keyboard navigation, filter restoration and validation, Checkbox selection, confirmation cancellation, clone forms and the mobile Sidebar/Sheet. It saves screenshots in `apps/web/test-results`. The CI workflow runs generation checks, lint/types, tests, builds and these essential browser workflows. Avoid parallel test suites sharing the same fixture queue.

Generated code lives in `apps/web/src/api/generated` and is disposable. Change domain DTOs and the endpoint registry in `internal/api/contract.go`, then regenerate. Do not edit or format generated files. TypeScript 6 is pinned because Hey API currently requires its JavaScript compiler API; TypeScript 7 is not compatible with this generator version.

See [architecture and data provenance](docs/architecture.md) and [interface design](docs/design.md). The backend uses Chandlery's environment and Zog error helpers and `db.Repository[*Model]` for audit log and saved-view reads and writes, with Bun for migrations, audit finalization and schedule links.

Upstream references: [Asynq Inspector](https://github.com/hibiken/asynq/blob/master/inspector.go), [native metrics collector](https://github.com/hibiken/asynq/tree/master/x/metrics), [Chandlery](https://github.com/nanaaikinson/chandlery), [Bun](https://bun.uptrace.dev/guide/), [Zog](https://zog.dev/), [Hey API](https://heyapi.dev/docs/openapi/typescript/), [TanStack Router](https://tanstack.com/router/latest/docs/), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview).
