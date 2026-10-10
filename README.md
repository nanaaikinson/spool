<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/spool-horizontal-dark.svg">
    <img src="docs/assets/spool-horizontal-color.svg" alt="Spool" width="260">
  </picture>
</p>

A self-hosted observability and operations console for Asynq. React, TypeScript and Vite on the frontend; Go, Chi and the Asynq Inspector on the backend. PostgreSQL stores the audit log, saved views and periodic schedule links; it does not mirror tasks.

What Spool shows:

- **Dashboard**: needs-attention checks (no running servers, queues no server processes, paused queues, long waits, high failure rates, archived growth, servers at capacity, overdue schedules) and the top error groups.
- **Live activity**: tasks processing right now, what runs next, and a running tail of started and finished tasks.
- **Metrics**: historical Prometheus charts with a live mode.
- **Queues**, **All tasks**, **Scheduled** and **Failed** views, with payload and error inspection, retry/archive/delete/cancel/clone actions where the task state allows them, confirmed bulk actions, and saved views.
- **Servers**: each Asynq server process, its queues and its busy worker slots.
- **Periodic schedules**: cron specs with plain-English descriptions. Tasks link back to the schedule entry that enqueued them, and those links are kept in PostgreSQL after Asynq drops its enqueue history.
- **Settings & audit log**, a command palette, dark and light themes, and organization-scoped admin/operator/viewer roles.

## Install on your own Docker host

Have the Redis connection URL used by your Asynq workers ready, including its database index. With Docker, a Compose plugin supporting `up --wait`, Bash and OpenSSL installed:

```sh
git clone https://github.com/nanaaikinson/spool.git
cd spool
./scripts/install.sh
```

The terminal wizard asks for your Redis URL, administrator username, organization name, local port and console URL. It bundles PostgreSQL and Prometheus by default; choose external services if you already operate them. It enables organization management and generates separate administrator, database, session, data-encryption, setup and scrape secrets, builds the frontend and backend inside Docker, then waits for Redis/PostgreSQL readiness and checks metrics connectivity. Local Go, Node and pnpm installations are unnecessary.

Open the console URL you chose (default `http://localhost:8080`) and sign in using `SPOOL_ADMIN_USER` and `SPOOL_ADMIN_PASSWORD` from `.env.installation`. That file has owner-only permissions and also records the selected Compose files and project name. Rerunning the installer preserves it and reuses the same persistent volumes.

To prepare configuration before starting, run `./scripts/install.sh --configure-only`. Use `--env-file PATH` for a custom configuration location and pass the same path on reruns. `make self-host` runs the default installer; `make install` installs frontend development dependencies.

The app is published on loopback only; bundled PostgreSQL and Prometheus have no published host ports. Local HTTP access works directly or through an SSH tunnel. For remote browser access, choose an HTTPS URL and configure your reverse proxy, certificates and DNS. The installer enables secure cookies for HTTPS but does not provision the proxy.

See the [deployment guide](docs/deployment.md) for upgrades, backups, connection changes, manual Compose deployments, Dokploy and Coolify.

## Operate dedicated hosted instances

Use [compose.hosted.yaml](compose.hosted.yaml) as a separate Dokploy or Coolify resource for each customer. It pulls a pinned Spool image, creates private PostgreSQL and Prometheus stores, requires HTTPS cookies, and authenticates Prometheus scrapes with a separate token. Customer Redis connects directly through TLS or an approved private network.

Prepare each customer's runtime credentials with `python3 scripts/prepare-hosted.py CUSTOMER --image "$SPOOL_RELEASE_IMAGE"`, where the image is a tested full release tag or digest containing the hosted support. The command prompts for Redis privately and writes `deployments/CUSTOMER/.env.hosted` with owner-only permissions. Supply its values in the platform before deploying. The [hosted operator guide](docs/hosting.md) covers both platforms, onboarding, verification, backups and upgrades. This is an operator-managed dedicated offering; signup, billing and automatic provisioning are not included.

Rehearse a built image with `make smoke-hosted HOSTED_IMAGE=YOUR_IMAGE`: it starts a disposable HTTPS and Redis TLS stack, verifies the console and metrics, then tests redeployment, PostgreSQL restore and administrator recovery. After deployment, `python3 scripts/check_hosted.py --url YOUR_HTTPS_ORIGIN --credentials-file PRIVATE_JSON` validates the customer console without changing tasks or configuration. See the [pilot verification instructions](docs/hosting.md#verify-before-handing-over-access).

Create private PostgreSQL backups on the deployment host with `python3 scripts/backup_hosted.py --project ACTUAL_COMPOSE_PROJECT --output-dir PRIVATE_DIRECTORY`. The command publishes a completed dump and checksum, preserving earlier backups and removing failed partial dumps. The [backup procedure](docs/hosting.md#operate-back-up-and-upgrade) covers scheduling, encrypted off-host storage, key preservation and restore verification.

Settings now shows Redis, database and metrics collection checks. Set `SPOOL_INSTANCE_NAME` and `SPOOL_SUPPORT_URL` at runtime to identify the instance and provide a public support contact; these appear before sign-in. The hosted preparation command also accepts `--instance-name`, `--environment` and `--support-url`. See [runtime metadata](docs/deployment.md#instance-identity-support-and-diagnostics).

## Try the published image

Spool connects to the Redis your Asynq workers already use. It doesn't replace your workers or need their code. The quickest way to try it is the published image with a Redis URL and an account (Spool always requires sign-in when it listens beyond localhost, as it does in a container):

```sh
docker run --rm -p 127.0.0.1:8080:8080 \
  -e REDIS_URL='redis://:PASSWORD@redis.internal:6379/0' \
  -e SPOOL_ADMIN_USER=admin -e SPOOL_ADMIN_PASSWORD='choose-a-long-password' \
  -e SPOOL_SESSION_KEY="$(openssl rand -hex 32)" \
  ghcr.io/nanaaikinson/spool:latest
```

Open http://127.0.0.1:8080 and sign in. Without a database Spool runs **read-only**: everything is visible, but pausing queues and acting on tasks are off. Add `DATABASE_URL` (PostgreSQL) to turn on actions, the audit log, saved views and schedule links:

```sh
docker run -d --name spool -p 127.0.0.1:8080:8080 \
  -e REDIS_URL='rediss://spool:PASSWORD@redis.internal:6380/0' \
  -e DATABASE_URL='postgres://spool:PASSWORD@postgres.internal:5432/spool?sslmode=verify-full' \
  -e SPOOL_ADMIN_USER=admin -e SPOOL_ADMIN_PASSWORD='choose-a-long-password' \
  -e SPOOL_SESSION_KEY="$(openssl rand -hex 32)" \
  ghcr.io/nanaaikinson/spool:latest
docker logs spool   # reports whether it reached Redis and found your queues
```

Images are published for linux/amd64 and linux/arm64. Pin a version tag such as `0.1.0` in production. The [deployment guide](docs/deployment.md) covers Compose, Dokploy, Coolify, HTTPS and Prometheus.

### Organizations and user management

New guided and hosted installations enable organization management. Each organization has its own Redis connection, members, roles, audit log, saved views and schedule links. Settings manages members, roles and accounts; the sidebar switches organizations. The first administrator can create additional organizations and manage deployment-wide accounts. Settings supports administrator grants and ownership transfer with password verification; `spool admin recover` restores an existing administrator through operator PostgreSQL access.

Use `./scripts/install.sh --browser-setup` to create the first organization and administrator in the UI with the generated private setup token. For terminal setup, the normal wizard collects the organization name and creates the account at startup. The same setup API is available through `spool setup --url ORIGIN < private-setup.json`. Existing manual installations can enable this mode without replacing task storage; see the [organization setup, migration and RBAC guide](docs/organizations.md).

## Connecting to Redis

- **Use the same database number as your workers.** `redis://host:6379/2` reads database 2. If Spool starts but shows no queues, its log says so; the database number is the usual cause.
- **Supported URLs:** `redis://` (plain), `rediss://` (TLS), `redis-sentinel://:password@host1:26379,host2:26379/0?master=NAME` (Sentinel; add `&sentinel_password=…` if the Sentinels use a different password from Redis), and `redis-socket://:password@/path/to/redis.sock?db=0` (Unix socket). Usernames for Redis ACLs go before the password: `rediss://spool:PASSWORD@host:6380/0`. Percent-encode special characters in credentials.
- **Private CA or client certificates:** mount the files and set `REDIS_TLS_CA_FILE`, and `REDIS_TLS_CERT_FILE` plus `REDIS_TLS_KEY_FILE` for mutual TLS. These apply to `rediss://` and `redis-sentinel://` URLs.
- **Redis Cluster** isn't supported yet.
- **Permissions:** viewing needs read access to the `asynq:*` keys and Lua scripting, as Asynq's own Inspector does; pausing queues and acting on tasks need write access. For people who only need to look, use a viewer account or `SPOOL_READ_ONLY=true`.
- **Network:** inside a container, `localhost` is the Spool container itself. Use a hostname your Redis is reachable at from there.

### Compatibility

Spool is built and tested against Asynq **v0.26**. It reads Asynq's data in Redis directly through Asynq's Inspector, so workers on other Asynq versions may store data Spool can't read. Please report incompatibilities with your worker version.

## Develop locally

Requires Go 1.27+, Node 24+, pnpm 10.33 (pinned in `apps/web/package.json`), and Docker Compose. [Air](https://github.com/air-verse/air) is optional: `make dev` uses it for live reload when installed and falls back to `go run` otherwise. With Corepack, run `corepack enable` once; the Makefile runs pnpm inside `apps/web` so Corepack picks the pinned version.

```sh
cp .env.example .env
make install
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

The [guided installer](#install-on-your-own-docker-host) manages configuration on your Docker host. For manual deployments or a hosting platform, choose a base Compose file and enter credentials before startup:

| Dependencies | Compose file | Environment template |
| --- | --- | --- |
| Your Redis + bundled PostgreSQL | [compose.production.redis.yaml](compose.production.redis.yaml) | [.env.production.redis.example](.env.production.redis.example) |
| Your Redis + your PostgreSQL | [compose.production.external.yaml](compose.production.external.yaml) | [.env.production.external.example](.env.production.external.example) |

Both build the root Dockerfile, require production credentials, and expose port 8080 only to the container network. The optional [host override](compose.production.host.yaml) publishes it on loopback for a host-installed HTTPS proxy.

Add the [Prometheus override](compose.production.prometheus.yaml) to either base file to bundle private metrics storage. It scrapes `app:8080` and retains 15 days of history in a persistent volume. The guided installer includes it unless you choose external Prometheus.

See the [production deployment guide](docs/deployment.md) for exact commands, Dokploy/Coolify settings, Dockerfile-only hosting, connection URLs, HTTPS, metrics routing, and persistent storage.

## Configuration

The Go server reads configuration at startup. It loads `.env` from its working directory when present without overriding process environment variables. The guided installer passes `.env.installation` through Compose; the server does not load that file directly. The frontend build does not need Redis, PostgreSQL or Prometheus credentials, and connection credentials are never bundled into frontend assets or returned by the API; deployment administrators can submit new connection URLs through authenticated forms.

| Configuration file | Used by | Purpose |
| --- | --- | --- |
| `.env` (copy `.env.example`) | Native development server | Local development connections and settings |
| `.env.installation` (generated) | Guided installer and its Compose stack | Saved service choices, credentials, access settings and project identity |
| `.env.production` (copy the matching production template) | Manual Compose, hosting platforms or `docker run` | User-supplied production settings; use the parser rules in the deployment guide |

The defaults below are for the standalone Go server. The installer provisions PostgreSQL and Prometheus and supplies their URLs. Missing URLs on a standalone deployment do not automatically create those services. Change runtime settings in the appropriate file or hosting dashboard and redeploy.

| Variable | Purpose | Default |
| --- | --- | --- |
| `SPOOL_ADDR` | HTTP listen address | `127.0.0.1:8088` |
| `REDIS_URL` | Asynq connection URI, including DB index | `redis://127.0.0.1:6388/0` |
| `DATABASE_URL` | PostgreSQL URI for accounts, organizations, audit, saved views and schedule links; without it Spool is read-only | unset |
| `REDIS_TLS_CA_FILE` | PEM file with the CA that signed your Redis server certificate | unset |
| `REDIS_TLS_CERT_FILE`, `REDIS_TLS_KEY_FILE` | Client certificate and key for Redis mutual TLS | unset |
| `PROMETHEUS_URL` | Prometheus base URL, with optional URI credentials | unset |
| `SPOOL_MULTI_ORG` | Enable persistent accounts and multiple isolated organizations; enabled by new guided/hosted setups | `false` |
| `SPOOL_ORGANIZATION_NAME` | First organization's name during environment bootstrap | `My organization` |
| `SPOOL_DATA_KEY` | Independent stable encryption secret, at least 32 characters in organization mode | unset |
| `SPOOL_SETUP_TOKEN` | Private first-setup token; required when bootstrapping through the UI/CLI API | unset |
| `SPOOL_ENV` | Environment label | `development` |
| `SPOOL_STATIC_DIR` | Compiled frontend directory | `apps/web/dist` |
| `SPOOL_READ_ONLY` | Disable operational/admin writes; managed users can still change their own password | `false` |
| `SPOOL_ADMIN_USER`, `SPOOL_ADMIN_PASSWORD` | Legacy admin or initial managed bootstrap account | unset |
| `SPOOL_VIEWER_USER`, `SPOOL_VIEWER_PASSWORD` | Legacy viewer or initial managed bootstrap viewer | unset |
| `SPOOL_SESSION_KEY` | Session signing secret; at least 32 characters when accounts are set | unset |
| `SPOOL_SECURE_COOKIE` | HTTPS-only session cookie | `false` |

Accounts are required when `SPOOL_ADDR` is not a loopback address. Use long random account passwords and a random signing secret. For remote access, use TLS termination and `SPOOL_SECURE_COOKIE=true`; the installer's localhost HTTP option uses `false`. Protect Redis and PostgreSQL with their own network and credentials. Expose `/metrics` only to the monitoring network; exclude it from public ingress. Stateless signed sessions expire after 12 hours. Changing the signing key revokes all sessions; logout deletes the browser cookie. With `SPOOL_MULTI_ORG=true`, PostgreSQL-backed accounts and memberships replace the configured accounts after initial setup. Legacy admin/viewer mode remains available when organization management is disabled. See [organizations and access](docs/organizations.md).

Without PostgreSQL, Spool runs read-only and says so in a banner: every change is refused before it reaches Redis, saved views and the audit log are unavailable, and task-to-schedule links last only as long as Asynq keeps its enqueue history. Migrations run under an advisory lock at startup. Each change is written to the audit log as pending before the Redis action and marked succeeded or failed afterward, so a record left pending (for example after a crash) means the outcome is unknown. Payloads are never stored in the audit log. Back up PostgreSQL and retain audit records as your deployment requires.

`/health` checks the running process; `/ready` checks Redis and, when configured, PostgreSQL in legacy mode; organization mode checks PostgreSQL, with each organization’s Redis checked in Settings. Prometheus is optional and does not block server readiness; the installer performs its own metrics check after starting services. Structured logs include request IDs, route templates, statuses and timings. `/metrics` exports native Asynq metrics, Go/process metrics and `spool_http_request_duration_seconds`.

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
make test-install  # Installer and Compose checks; Python 3 + Docker Compose, no running containers
(cd apps/web && pnpm exec prettier --write src e2e '*.ts')
```

Real integration tests use explicitly configured isolated services:

```sh
SPOOL_TEST_REDIS=redis://127.0.0.1:6388/15 \
SPOOL_TEST_DATABASE='postgres://spool:spool-local@127.0.0.1:5448/spool?sslmode=disable' \
go test -race ./internal/...

(cd apps/web && pnpm exec playwright install chromium)
make e2e
```

Playwright seeds only the `spool-e2e` queue in Redis database 15, starts isolated API instances on ports 8188/8189 and Vite on 5188, then tests themes, persistence, queue status tabs, task navigation, scheduled summaries, advanced filters, archive/retry, failures, a command palette, non-JSON payloads, mobile layout, session roles and saved-view creation/restoration/deletion. It also verifies shadcn Select keyboard navigation, filter restoration and validation, Checkbox selection, confirmation cancellation, clone forms and the mobile Sidebar/Sheet. It saves screenshots in `apps/web/test-results`. The CI workflow runs generation checks, lint/types, tests, builds and these essential browser workflows. Avoid parallel test suites sharing the same fixture queue.

Generated code lives in `apps/web/src/api/generated` and is disposable. Change domain DTOs and the endpoint registry in `internal/api/contract.go`, then regenerate. Do not edit or format generated files. TypeScript 6 is pinned because Hey API currently requires its JavaScript compiler API; TypeScript 7 is not compatible with this generator version.

See [architecture and data provenance](docs/architecture.md) and [interface design](docs/design.md). The backend uses Chandlery's environment and Zog error helpers and `db.Repository[*Model]` for audit log and saved-view reads and writes, with Bun for migrations, audit finalization and schedule links.

Upstream references: [Asynq Inspector](https://github.com/hibiken/asynq/blob/master/inspector.go), [native metrics collector](https://github.com/hibiken/asynq/tree/master/x/metrics), [Chandlery](https://github.com/nanaaikinson/chandlery), [Bun](https://bun.uptrace.dev/guide/), [Zog](https://zog.dev/), [Hey API](https://heyapi.dev/docs/openapi/typescript/), [TanStack Router](https://tanstack.com/router/latest/docs/), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview).
