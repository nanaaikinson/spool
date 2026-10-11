# Production deployment

Spool ships as one non-root container image that serves both the UI and the API on **8003**. You do not need a separate Node server or frontend deployment.

For a Docker host you operate, start with the guided installer below. Use the manual Compose files when you need custom networks/mounts or deploy through Dokploy/Coolify. The published image runs Spool with dependencies you provision separately.

For an operator-managed dedicated hosted offering, use the separate [hosted guide](hosting.md) and `compose.hosted.yaml`. That standalone template pulls a pinned image, provisions isolated customer storage and authenticates Prometheus scrapes. The source-based self-hosted files below remain available for installations you operate yourself.

## Guided installation on your own Docker host

From a checkout of Spool, run `./scripts/install.sh` (or `make self-host`). You need Docker with a Compose plugin supporting `up --wait`, Bash and OpenSSL. The frontend and backend build inside Docker; local Go, Node and pnpm installations are unnecessary.

The wizard asks for:

1. Your existing Asynq Redis URL, including the database index your workers use. Secret URLs are hidden when entered in a terminal.
2. Bundled PostgreSQL (default), or an external PostgreSQL URL containing an existing database.
3. Bundled Prometheus (default), or an external Prometheus URL whose scraper collects Spool's metrics.
4. An administrator username, the loopback host port, console URL, and organization name. Local access defaults to `http://localhost:8003`; for a remote server, enter your HTTPS proxy's origin.

The installer generates separate random administrator, PostgreSQL, session, data-encryption, setup and scrape secrets and saves them in `.env.installation` with permissions `600`. Read `SPOOL_ADMIN_USER` and `SPOOL_ADMIN_PASSWORD` in that file to sign in; you can set your own administrator password there before startup. Keep it private and backed up alongside your database. It is a **Compose dotenv file**, with literal single-quoted values; do not source it or use it with `docker run --env-file`.

Add `--browser-setup` to choose the first organization name and administrator in the UI using the private `SPOOL_SETUP_TOKEN`. Otherwise the wizard’s organization and account are bootstrapped once at startup. See [organization setup and RBAC](organizations.md).

Use `./scripts/install.sh --configure-only` to save and validate configuration before starting. The installer never replaces an existing configuration file or regenerates secrets on reruns. A file created outside the wizard is left untouched; use `--env-file PATH` to choose a different file. Cancelled or incomplete prompts do not save configuration. Re-running without `--configure-only` builds and starts services, waits for Redis and PostgreSQL readiness, and checks that bundled Prometheus can scrape Spool (or that an external Prometheus responds to a query). Historical charts fill as samples accumulate.

Bundled PostgreSQL and Prometheus each use a persistent named volume, have no published host ports, and restart after host restarts. Prometheus scrapes `app:8003` on the private Compose network and retains 15 days of metrics. An external service that is configured but unavailable does not cause a fallback to a bundled service.

For local access, the wizard disables HTTPS-only cookies and publishes the app on `127.0.0.1` only. For remote access, it enables HTTPS-only cookies: configure your host's [HTTPS reverse proxy](#https-and-proxy-routing) before signing in. The wizard does not install a proxy, provision certificates or change DNS. For remote setup without a proxy, keep the localhost URL and use an SSH tunnel, for example `ssh -L 8003:127.0.0.1:8003 user@server`, then browse to `http://localhost:8003` on your computer.

The saved `COMPOSE_FILE` list selects the production dependency files and loopback port override, and `COMPOSE_PROJECT_NAME=spool-production` keeps the same volumes across deployments. From this checkout:

```sh
docker compose --env-file .env.installation ps
docker compose --env-file .env.installation logs --tail 100 app
docker compose --env-file .env.installation stop
# After updating the checkout, rebuild and check readiness using the same secrets:
./scripts/install.sh
```

Use the same `--env-file PATH` on reruns if you selected a custom path; its parent directory must already exist. The file contains absolute Compose paths; update `COMPOSE_FILE` if you move the checkout. To change between bundled and external services, edit both that list and the matching connection values after migrating any data you want to keep. Configuration is read at startup, so redeploy after editing it. Do not change the project name or run `down -v` during upgrades. The wizard ignores inherited connection/account environment variables; direct Compose commands use normal shell-variable precedence.

A different env-file name alone does not create an independent installation: the wizard defaults to the `spool-production` Compose project. For a second environment, use `--configure-only`, then choose a distinct `COMPOSE_PROJECT_NAME` and host port before starting it. When moving an existing manual deployment into guided configuration, preserve its secrets and project identity rather than generating new credentials for an existing database volume.

The generated file also contains these deployment settings:

| Setting | Meaning |
| --- | --- |
| `COMPOSE_FILE` | Absolute paths to the selected base file, optional metrics override and host-port override |
| `COMPOSE_PATH_SEPARATOR` | `:` for the file list created by the installer |
| `COMPOSE_PROJECT_NAME` | Stack/network/volume identity; defaults to `spool-production` |
| `POSTGRES_PASSWORD` | Bundled PostgreSQL role password; ignored by the external-database base file |
| `SPOOL_HOST_PORT` | Host loopback port, mapped to container port 8003 |
| `SPOOL_INSTALL_URL` | Console URL printed by the installer; does not configure DNS, proxy routing or cookie settings |

Server settings such as `REDIS_URL`, account credentials and `SPOOL_SECURE_COOKIE` are described in the [README configuration reference](../README.md#configuration).

For private CAs or client certificates, configure the necessary read-only mounts and `REDIS_TLS_*` environment entries through an additional Compose override before starting; see [connection values](#connection-values). The wizard handles TCP Redis, TLS Redis and Sentinel URLs; Unix socket Redis requires legacy mode (`SPOOL_MULTI_ORG=false`), a manual socket mount and deployment configuration. A container's `localhost` refers to that container; use a reachable private host or shared Docker network for external services.

## Published image

Each release publishes `ghcr.io/nanaaikinson/spool` for linux/amd64 and linux/arm64, tagged with the full version (`0.1.0`), the minor version (`0.1`) and `latest`. Pin the full version in production and read the [changelog](../CHANGELOG.md) before upgrading. Images carry build provenance and an SBOM.

```sh
cp .env.production.external.example .env.production
chmod 600 .env.production
# Edit .env.production: fill both connection URLs, admin password and signing key.
docker run -d --name spool --restart unless-stopped \
  --stop-timeout 30 --env-file .env.production \
  -p 127.0.0.1:8003:8003 ghcr.io/nanaaikinson/spool:0.1.0
docker logs spool
```

The log says whether Spool reached Redis and found your Asynq queues. Without `DATABASE_URL` it runs read-only. The sections below build from source instead, which suits platforms that deploy from a Git repository.

## Manual Compose files

Choose the dependencies you want Spool to manage:

| Deployment | Compose file | Environment template |
| --- | --- | --- |
| Your Asynq Redis + a bundled PostgreSQL 17 database | `compose.production.redis.yaml` | `.env.production.redis.example` |
| Your Asynq Redis + your PostgreSQL database | `compose.production.external.yaml` | `.env.production.external.example` |

Both require real credentials, restart services after host restarts, and use the image's `/ready` health check. The base files connect to your existing Asynq Redis; they do not start workers or demo traffic. PostgreSQL in the first option has a persistent named volume and no published host port. The app has no local application data that needs a volume.

Add `-f compose.production.prometheus.yaml` to either production deployment to bundle private metrics storage. This sets the app's Prometheus URL to `http://prometheus:9090`; omit the override when using external Prometheus. The guided installer selects this override by default.

| Optional override | Purpose |
| --- | --- |
| `compose.production.prometheus.yaml` | Private Prometheus, 15-day retention and persistent metrics volume |
| `compose.production.host.yaml` | Publish the app on `127.0.0.1:${SPOOL_HOST_PORT:-8003}` for local access or a host proxy |

Manual base files do not include Prometheus unless you add its override or set an external `PROMETHEUS_URL`. Supply runtime values through `.env.production` or your platform's environment dashboard; do not use the installer's file on a hosting platform without adapting its absolute paths and host-port choices.

## Instance identity, support and diagnostics

Runtime settings apply to the same built UI; no frontend rebuild is needed per deployment:

| Setting | Behavior |
| --- | --- |
| `SPOOL_INSTANCE_NAME` | Friendly public name, at most 80 characters; defaults to `SPOOL_ENV` |
| `SPOOL_ENV` | Environment label, such as production or staging |
| `SPOOL_DEPLOYMENT_MODE` | `self-hosted` (default) or `hosted`; selects account recovery/support guidance |
| `SPOOL_SUPPORT_URL` | Optional public HTTPS or mailto support link; embedded URL credentials are rejected |
| `SPOOL_METRICS_JOB` | Prometheus scrape job checked by diagnostics; defaults to `spool` |

The name, environment, deployment mode and support link appear before sign-in. Use only public information in these fields. Secrets, connection URLs and target labels are never returned by the diagnostics API.

Settings shows live connection checks for Redis, PostgreSQL and Prometheus, with manual refresh and 30-second polling. Authenticated `GET /api/v1/status` returns each check independently, including failures, with an HTTP response deadline of five seconds. It is a console diagnostic endpoint; `/ready` remains the deployment readiness probe.

Metrics diagnostics validate the Prometheus response and check active targets matching the configured job. They distinguish missing targets, pending collection, failed scrapes and unavailable target inspection. The UI reports first-sample collection only after a healthy scrape and fewer than two successful samples in the last two minutes. Rate charts require multiple samples; missing data in an older range is not reconstructed. If the target API is unavailable, scrape health remains unverified even when queries work. Legacy chart queries require Prometheus to contain only the intended Asynq environment. Organization mode scopes every chart expression to both the deployment job and organization ID; native scrapes carry an `organization` label.

An empty queue list may be valid for a new environment. Dashboard and Queues guide users to verify the Redis database rather than labelling every empty deployment as a connection failure.

## Connection values

Use the same Redis host, port, **database index**, and credentials as your existing Asynq application. Spool currently uses Asynq v0.26.0; verify compatibility if your workers use a different release or a custom fork. Spool connects through Inspector; it does not replace your workers or require their source code.

Example connection formats, with placeholders to replace:

```dotenv
# Password-only Redis
REDIS_URL=redis://:URL_ENCODED_PASSWORD@redis.example.com:6379/0
# Named Redis ACL user, with TLS
REDIS_URL=rediss://spool:URL_ENCODED_PASSWORD@redis.example.com:6380/0
# Redis Sentinel; add &sentinel_password=… if the Sentinels use their own password
REDIS_URL=redis-sentinel://:URL_ENCODED_PASSWORD@sentinel-1.example.com:26379,sentinel-2.example.com:26379/0?master=mymaster
# External PostgreSQL with certificate and hostname verification
DATABASE_URL=postgres://spool:URL_ENCODED_PASSWORD@postgres.example.com:5432/spool?sslmode=verify-full
```

Percent-encode special characters in URI usernames/passwords, including `@`, `:`, `/`, `#`, and `%`. Use your provider's endpoint and TLS settings. Publicly trusted TLS certificates work with the image's CA bundle; a private PostgreSQL CA requires a read-only certificate mount and `sslrootcert=/path/in/container/ca.pem` in `DATABASE_URL`. For Redis behind a private CA, mount the CA file read-only and set `REDIS_TLS_CA_FILE` to its path; for mutual TLS also set `REDIS_TLS_CERT_FILE` and `REDIS_TLS_KEY_FILE`. These apply to `rediss://` and `redis-sentinel://` URLs. Redis Cluster is not supported yet.

External PostgreSQL must already contain the database named in `DATABASE_URL`. Give the application role permission to create its tables/indexes and read/write them. Spool runs its own migrations on startup; no separate migration command is needed. PostgreSQL holds accounts, organizations, encrypted connection settings, the audit log, saved views and the links between tasks and the periodic schedules that enqueued them. Tasks remain in your Asynq Redis.

Generate a different random value for each secret:

```sh
openssl rand -hex 32
```

Use the output for `SPOOL_ADMIN_PASSWORD`, repeat for `SPOOL_SESSION_KEY`, and repeat for `POSTGRES_PASSWORD` when using bundled PostgreSQL. The signing key must be at least 32 characters. For bundled PostgreSQL, use a hexadecimal/alphanumeric password because Compose interpolates it directly into the connection URI. Keep the signing key stable between deployments to preserve sessions.

Containers have their own loopback interface. A URL containing `localhost` or `127.0.0.1` connects to the Spool container itself. Use a reachable private DNS name or the database service name on a shared Docker network. Allow connections from the deployment server in your database firewall.

## Dokploy

1. Put the project in your Git repository. Create a **Docker Compose** resource and connect that repository and branch.
2. Select Compose mode and the chosen root-level production file. Stack mode cannot build this source-based configuration.
3. In **Environment**, enter the values from the matching template. These files explicitly pass environment variables to containers.
4. In **Domains**, target service `app`, path `/`, container port **8003**, and enable HTTPS with your certificate provider. Point your domain's DNS at the server.
5. Preview the generated Compose definition. Keep `app` and `postgres` on their shared `default` network; Dokploy also connects `app` to its proxy network. Deploy after domain changes.

For bundled metrics, merge the Prometheus override into the Compose definition selected by the resource and keep service `prometheus` without a domain. The override generates its configuration inside the container and uses a private credentials file when `SPOOL_METRICS_TOKEN` is set; no repository bind mount or File Mount is required. Do not add the host-port override; the platform proxy connects to the app's internal port. Dokploy adds the proxy labels. Leave PostgreSQL without a domain or published port. See the official [Compose guide](https://docs.dokploy.com/docs/core/docker-compose) and [Compose domains guide](https://docs.dokploy.com/docs/core/docker-compose/domains).

## Coolify

1. Create a resource from the project's **Git repository** and select the **Docker Compose** build pack.
2. Set Base Directory to `/` and Docker Compose Location to `/compose.production.redis.yaml` or `/compose.production.external.yaml`.
3. Save/load the definition, then fill **Environment Variables** from the matching template. Required values must be populated before deploying.
4. Set service `app`'s domain to `https://spool.example.com:8003`. The suffix selects the internal container port; visitors use ordinary HTTPS on 443.
5. Keep **Raw Compose Deployment** disabled and deploy. Image-defined health checks apply to Compose deployments.

For bundled metrics, merge the Prometheus override into the Compose file selected by the resource and keep service `prometheus` without a domain. The override generates its configuration and optional scrape credentials file inside the container, so no repository-preservation setting is required for metrics. Do not add the host-port override. If connecting to another Coolify database resource, enable **Connect To Predefined Network** and use its actual internal hostname. The bundled PostgreSQL already shares this resource's network. See the official [Compose guide](https://coolify.io/docs/applications/builds/docker-compose).

## Dockerfile deployment on either platform

Use this when PostgreSQL and Redis are provisioned separately, including database resources managed by the hosting platform.

| Setting | Dokploy | Coolify |
| --- | --- | --- |
| Resource | Application linked to your Git repository | Application linked to your Git repository |
| Build type/pack | Dockerfile | Dockerfile |
| Build context/base directory | Repository root | `/` |
| Dockerfile | Root `Dockerfile` | `/Dockerfile` |
| Container port | Domain target port `8003` | Ports Exposes `8003` |
| Runtime environment | Values from `.env.production.external.example` | Values from `.env.production.external.example` |
| Domain | HTTPS domain for this application | HTTPS domain for this application |

The image already listens on `0.0.0.0:8003` and checks `/ready`. Supply secrets at runtime. The platform builds the frontend automatically; no custom start command is needed.

The Dockerfile requires the **whole repository as build context** because it copies the Go and frontend source. Pasting only its text into a deployment without source files cannot build this app. For deployment without a Git checkout, build and push an image to your registry, then use the platform's Docker Image resource.

See [Dokploy's Dockerfile build settings](https://docs.dokploy.com/docs/core/applications/build-type) and [Coolify's Dockerfile guide](https://coolify.io/docs/applications/builds/dockerfile).

## Compose on your own Docker host

For your Redis with bundled PostgreSQL and Prometheus:

```sh
cp .env.production.redis.example .env.production
chmod 600 .env.production
# Edit .env.production and supply REDIS_URL and the three generated secrets.
docker compose --env-file .env.production -p spool-production \
  -f compose.production.redis.yaml -f compose.production.prometheus.yaml \
  -f compose.production.host.yaml config --quiet
docker compose --env-file .env.production -p spool-production \
  -f compose.production.redis.yaml -f compose.production.prometheus.yaml \
  -f compose.production.host.yaml up -d --build --wait --wait-timeout 180
```

For your own Redis and PostgreSQL, copy `.env.production.external.example` instead, supply `DATABASE_URL`, and replace `compose.production.redis.yaml` with `compose.production.external.yaml` in both commands.

For external Prometheus, omit `-f compose.production.prometheus.yaml` from both commands, set `PROMETHEUS_URL`, and configure the external server to scrape Spool. For localhost HTTP access, set `SPOOL_SECURE_COOKIE=false` before starting and browse to the loopback port; retain `true` when using an HTTPS proxy.

The optional `compose.production.host.yaml` override publishes **127.0.0.1:8003** for a reverse proxy installed on the host. Set `SPOOL_HOST_PORT` if that port is occupied. Omit this override on Dokploy/Coolify, or when a containerized proxy connects directly to `app:8003` on the Compose network.

## Dockerfile on your own Docker host

This runs only Spool. Provide your own PostgreSQL and Redis:

```sh
cp .env.production.external.example .env.production
chmod 600 .env.production
# Edit .env.production: fill both connection URLs, admin password and signing key.
docker build -t spool:production .
docker run -d --name spool --restart unless-stopped \
  --stop-timeout 30 --env-file .env.production \
  -p 127.0.0.1:8003:8003 spool:production
docker inspect --format '{{.State.Health.Status}}' spool
docker logs spool
```

Use unquoted literal values in an env file shared with `docker run`; its parser does not remove quotes or expand variables like Compose's dotenv parser. The generated hexadecimal secrets avoid interpolation differences. Never put production secrets into Dockerfile `ENV`, build arguments, or the Git repository. Production env files are ignored by Git and excluded from the Docker build context.

## HTTPS and proxy routing

Keep `SPOOL_SECURE_COOKIE=true` and access the UI through HTTPS. Direct HTTP readiness checks work, but an HTTPS-only session cookie cannot support an ordinary remote HTTP login.

The guided installer chooses the cookie setting from your console URL. Changing `SPOOL_INSTALL_URL` later only changes its printed link: update `SPOOL_SECURE_COOKIE` and proxy settings separately when changing access modes.

Preserve the original HTTP `Host` header so same-origin checks work. Allow streaming responses for `/api/v1/events`; do not enable proxy buffering for SSE. Serve Spool at the domain root.

`/metrics` requires a separate token in organization mode; new guided installs generate it and configure bundled Prometheus automatically. Legacy mode can omit `SPOOL_METRICS_TOKEN`, making its scrape path unauthenticated: keep it on a private monitoring path/network, or deny that exact path at public ingress. For a Traefik public router, the route rule can be ``Host(`spool.example.com`) && !Path(`/metrics`)``: apply it to the generated public router using your platform's proxy-label configuration. Keep `/api/v1/metrics` accessible; it is a separate authenticated API endpoint.

For a direct image deployment, you can instead pass `SPOOL_METRICS_TOKEN` at runtime and configure Prometheus to send `Authorization: Bearer TOKEN` using an authorization credentials file. Tokens require at least 32 characters without whitespace. Console session cookies do not authorize scrapes. The dedicated hosted template and bundled production metrics override pass this setting to the app and configure Prometheus automatically; setting it only on the app breaks an unconfigured scraper. Older images ignore this variable, so verify anonymous scrapes return 401 after deploying an image with token support.

For example, with **Caddy installed directly on the Docker host**, this Caddyfile routes the UI/API, denies public metrics, and uses automatic HTTPS. Point the domain's DNS at the host and allow Caddy to receive traffic on ports 80 and 443:

```caddyfile
spool.example.com {
    @metrics path /metrics
    handle @metrics {
        respond 404
    }
    handle {
        reverse_proxy 127.0.0.1:8003
    }
}
```

Caddy preserves Host for this HTTP upstream and streams SSE responses. See its [reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and [automatic HTTPS documentation](https://caddyserver.com/docs/automatic-https).

## Metrics, persistence and updates

Set `PROMETHEUS_URL` only if you have Prometheus. Its scrape target should reach this app's internal `:8003/metrics`; for a shared Docker network, use `app:8003`. Without Prometheus, queues, tasks, live activity and the dashboard checks still work, but the charts, the Metrics page and the archive-growth check have no data.

The optional `compose.production.prometheus.yaml` already configures this target and persistent storage. On Dokploy/Coolify, merge it into the selected deployment definition and follow the platform-specific configuration-mount instructions above; keep that service private without a domain. With external Prometheus, restrict its Spool queries/scrape targets to the intended Asynq environment; legacy metric expressions do not distinguish multiple environments sharing queue names. Organization mode requires the `organization` label and filters by it and `SPOOL_METRICS_JOB`.

Back up the bundled PostgreSQL database and keep its named volume. Keep the same Compose project name/resource and the original `SPOOL_DATA_KEY` across redeployments; back up the key separately from PostgreSQL. Do not use `docker compose down -v` unless you intend to delete the audit log, saved views and periodic schedule links. Changing `POSTGRES_PASSWORD` in the environment does not change a password in an already initialized PostgreSQL volume: rotate the database role's password and update the app together. Keep PostgreSQL on major version 17 until you perform a planned database upgrade.

After updates, rebuild/redeploy and verify `/ready` and the HTTPS login. `/health` only confirms the process is running; `/ready` checks Redis and PostgreSQL in legacy mode, or PostgreSQL in organization mode. Check each organization’s Redis in Settings. If startup fails, inspect logs for database reachability, credentials, migration permissions, or an invalid session key.

### Backups

For bundled PostgreSQL, create a private backup outside the checkout:

```sh
umask 077
mkdir -p "$HOME/spool-backups"
docker compose --env-file .env.installation exec -T postgres \
  pg_dump -U spool -d spool > "$HOME/spool-backups/spool-$(date +%Y%m%d-%H%M%S).sql"
```

Check the command's exit status and restore backups into an isolated empty database periodically. A PostgreSQL backup covers accounts, organizations, encrypted connection settings, audit logs, saved views and schedule links; preserve the original `SPOOL_DATA_KEY` separately to decrypt restored connections. Back up `.env.installation` separately to retain credentials and project settings. Metrics history lives in the separate Prometheus volume; preserving that volume is necessary to retain it through updates. Tasks remain in your existing Redis and follow that service's backup policy. Use your provider's backup procedure for external PostgreSQL or Prometheus.

## Connection and account changes

In organization mode, use Settings for account passwords, disabling, membership roles and connection replacement. Environment account variables are bootstrap-only and never reset existing database accounts. Keep `SPOOL_DATA_KEY` unchanged; see [migration and recovery](organizations.md#upgrading-an-existing-installation). The environment rotation procedure below applies to legacy accounts and infrastructure services.

Edit the saved runtime configuration, then rerun the installer with the same `--env-file` to recreate services and recheck readiness. For manual deployments, repeat your original Compose command with the same file list and project name; for hosting platforms, update runtime variables and redeploy.

- **Administrator password:** update `SPOOL_ADMIN_PASSWORD`. Existing signed sessions remain valid until expiry; also rotate `SPOOL_SESSION_KEY` when you want to invalidate them.
- **Viewer access:** set both `SPOOL_VIEWER_USER` and `SPOOL_VIEWER_PASSWORD`, using a different username from the administrator. Viewers cannot perform task or queue changes.
- **Redis credentials or database:** update `REDIS_URL` and verify the database index against your workers. Switching to a different Asynq environment should use a separate deployment, database and metrics store to keep operational history separate.
- **Bundled PostgreSQL password:** change the database role's password and `POSTGRES_PASSWORD` together. Editing the file alone cannot rotate a password in an already initialized volume.
- **External database/metrics:** update `DATABASE_URL` or `PROMETHEUS_URL`. When switching away from a bundled service, also change `COMPOSE_FILE`; the bundled PostgreSQL base file constructs its own URL, and the metrics override fixes the URL to the bundled server. Migrate existing data before switching.

Generated Compose values are single-quoted to keep dollar signs literal. Percent-encode URI credentials containing reserved characters, apostrophes or backslashes. Configuration stays server-side; rebuilding frontend assets with secrets is unnecessary.

## Troubleshooting

Use `docker compose --env-file .env.installation ps` and `docker compose --env-file .env.installation logs --tail 100 app` for guided deployments. Inspect `postgres` or `prometheus` logs only when that service is bundled. With a custom configuration path, use it in each command. Logs may include operational details; remove sensitive data before sharing them.

| Symptom | What to check |
| --- | --- |
| Docker is unavailable | Start the Docker daemon and confirm your account can access it; rerun with the saved configuration |
| Setup refuses an existing file | It only reuses files generated by the wizard; use the manual deployment instructions or a new `--env-file` path |
| App cannot become ready | Check Redis reachability, PostgreSQL credentials, database existence and migration permissions from the container network |
| App starts but shows no queues | Use the same Redis database index as the Asynq workers; an empty database can pass readiness |
| Local host port is occupied | Change `SPOOL_HOST_PORT` and the local `SPOOL_INSTALL_URL`, then rerun |
| Sign-in succeeds but does not persist | Match `SPOOL_SECURE_COOKIE` to access mode: HTTPS for remote access, `false` for loopback HTTP |
| Historical charts are empty | Check the Prometheus scrape target and allow samples to accumulate; a successful external query alone does not prove Spool is being scraped |
| Operations are disabled | Check `SPOOL_READ_ONLY`, whether you signed in as a viewer, and whether PostgreSQL is configured |
| Bundled PostgreSQL rejects a new password | The existing role still uses its old password; rotate the role and configuration together |
| External metrics check fails after app startup | Verify the URL, authentication and network access from the app container; services stay running for diagnosis and no bundled fallback is created |

Server readiness excludes Prometheus. The guided installer's final check includes metrics, so it can report a metrics error after Redis/PostgreSQL are healthy. Correct the configuration and rerun; it preserves credentials and existing data.
