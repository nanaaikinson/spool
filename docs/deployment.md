# Production deployment

Spool ships as one non-root container image that serves both the UI and the API on **8003**. You do not need a separate Node server or frontend deployment.

For a Docker host you operate, start with the guided installer below. Use the manual Compose files when you need custom networks or mounts. The published image runs Spool with dependencies you provision separately.

The production base file, `compose.production.redis.yaml`, runs Spool against your existing Asynq Redis and keeps its SQLite database in the `spool-data` named volume at `/data`. Add overrides to it as needed:

| Optional override | Purpose |
| --- | --- |
| `compose.production.prometheus.yaml` | Private Prometheus, 15-day retention and persistent metrics volume |
| `compose.production.host.yaml` | Publish the app on `127.0.0.1:${SPOOL_HOST_PORT:-8003}` for local access or a host proxy |

Manual base files do not include Prometheus unless you add its override or set an external `PROMETHEUS_URL`. Supply runtime values through `.env.production`.

## Instance identity, support and diagnostics

Runtime settings apply to the same built UI; no frontend rebuild is needed per deployment:

| Setting | Behavior |
| --- | --- |
| `SPOOL_INSTANCE_NAME` | Friendly public name, at most 80 characters; defaults to `SPOOL_ENV` |
| `SPOOL_ENV` | Environment label, such as production or staging |
| `SPOOL_SUPPORT_URL` | Optional public HTTPS or mailto support link; embedded URL credentials are rejected |
| `SPOOL_METRICS_JOB` | Prometheus scrape job checked by diagnostics; defaults to `spool` |

The name, environment, deployment mode and support link appear before sign-in. Use only public information in these fields. Secrets, connection URLs and target labels are never returned by the diagnostics API.

Settings shows live connection checks for Redis, the database and Prometheus, with manual refresh and 30-second polling. Authenticated `GET /api/v1/status` returns each check independently, including failures, with an HTTP response deadline of five seconds. It is a console diagnostic endpoint; `/ready` remains the deployment readiness probe.

Metrics diagnostics validate the Prometheus response and check active targets matching the configured job. They distinguish missing targets, pending collection, failed scrapes and unavailable target inspection. The UI reports first-sample collection only after a healthy scrape and fewer than two successful samples in the last two minutes. Rate charts require multiple samples; missing data in an older range is not reconstructed. If the target API is unavailable, scrape health remains unverified even when queries work. External Prometheus must still be scoped to the intended Asynq environment: changing the diagnostic job does not scope chart queries.

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
```

Percent-encode special characters in URI usernames/passwords, including `@`, `:`, `/`, `#`, and `%`. Use your provider's endpoint and TLS settings. Publicly trusted TLS certificates work with the image's CA bundle. For Redis behind a private CA, mount the CA file read-only and set `REDIS_TLS_CA_FILE` to its path; for mutual TLS also set `REDIS_TLS_CERT_FILE` and `REDIS_TLS_KEY_FILE`. These apply to `rediss://` and `redis-sentinel://` URLs. Redis Cluster is not supported yet.

`DATABASE_PATH` names the SQLite file that holds the audit log, saved views and the links between tasks and the periodic schedules that enqueued them. Tasks remain in your Asynq Redis. Spool creates the file, and any missing directories, and runs its embedded migrations on startup; the location must be writable by the container's `spool` user, so no separate migration command is needed. The path must not contain `?` or `#`. Without `DATABASE_PATH`, Spool runs read-only: no audit log, saved views or schedule links, and every change is refused.

Run exactly one Spool instance per database file. Keep the file on local storage, not NFS, SMB or another network filesystem; SQLite relies on file locking those filesystems do not reliably provide.

Generate a different random value for each secret:

```sh
openssl rand -hex 32
```

Use the output for `SPOOL_ADMIN_PASSWORD` and repeat for `SPOOL_SESSION_KEY`. The signing key must be at least 32 characters. Keep the signing key stable between deployments to preserve sessions.

Containers have their own loopback interface. A URL containing `localhost` or `127.0.0.1` connects to the Spool container itself. Use a reachable private DNS name or the Redis service name on a shared Docker network. Allow connections from the deployment server in your Redis firewall.

## Compose on your own Docker host

For your Redis with bundled Prometheus:

```sh
cp .env.production.redis.example .env.production
chmod 600 .env.production
# Edit .env.production and supply REDIS_URL and the two generated secrets.
docker compose --env-file .env.production -p spool-production \
  -f compose.production.redis.yaml -f compose.production.prometheus.yaml \
  -f compose.production.host.yaml config --quiet
docker compose --env-file .env.production -p spool-production \
  -f compose.production.redis.yaml -f compose.production.prometheus.yaml \
  -f compose.production.host.yaml up -d --build --wait --wait-timeout 180
```

For external Prometheus, omit `-f compose.production.prometheus.yaml` from both commands, set `PROMETHEUS_URL`, and configure the external server to scrape Spool. For localhost HTTP access, set `SPOOL_SECURE_COOKIE=false` before starting and browse to the loopback port; retain `true` when using an HTTPS proxy.

The optional `compose.production.host.yaml` override publishes **127.0.0.1:8003** for a reverse proxy installed on the host. Set `SPOOL_HOST_PORT` if that port is occupied. Omit it when a containerized proxy connects directly to `app:8003` on the Compose network.

## Dockerfile on your own Docker host

This runs only Spool. Provide your own Redis and a volume for the database file:

```sh
cp .env.production.redis.example .env.production
chmod 600 .env.production
# Edit .env.production: fill REDIS_URL, admin password and signing key.
docker build -t spool:production .
docker run -d --name spool --restart unless-stopped \
  --stop-timeout 30 --env-file .env.production \
  -v spool-data:/data -e DATABASE_PATH=/data/spool.db \
  -p 127.0.0.1:8003:8003 spool:production
docker inspect --format '{{.State.Health.Status}}' spool
docker logs spool
```

The image sets no default `DATABASE_PATH`. Its `/data` directory is owned by the non-root `spool` user, so a named volume mounted there is writable; a bind mount must be writable by that user.

Use unquoted literal values in an env file shared with `docker run`; its parser does not remove quotes or expand variables like Compose's dotenv parser. The generated hexadecimal secrets avoid interpolation differences. Never put production secrets into Dockerfile `ENV`, build arguments, or the Git repository. Production env files are ignored by Git and excluded from the Docker build context.

## HTTPS and proxy routing

Keep `SPOOL_SECURE_COOKIE=true` and access the UI through HTTPS. Direct HTTP readiness checks work, but an HTTPS-only session cookie cannot support an ordinary remote HTTP login.

The guided installer chooses the cookie setting from your console URL. Changing `SPOOL_INSTALL_URL` later only changes its printed link: update `SPOOL_SECURE_COOKIE` and proxy settings separately when changing access modes.

Preserve the original HTTP `Host` header so same-origin checks work. Allow streaming responses for `/api/v1/events`; do not enable proxy buffering for SSE. Serve Spool at the domain root.

`/metrics` is unauthenticated unless `SPOOL_METRICS_TOKEN` is configured. The self-hosted Compose files leave it unconfigured: keep it on a private monitoring path/network, or deny that exact path at public ingress. For a Traefik public router, the route rule can be ``Host(`spool.example.com`) && !Path(`/metrics`)``. Keep `/api/v1/metrics` accessible; it is a separate authenticated API endpoint.

For a direct image deployment, you can instead pass `SPOOL_METRICS_TOKEN` at runtime and configure Prometheus to send `Authorization: Bearer TOKEN` using an authorization credentials file. Tokens require at least 32 characters without whitespace. Console session cookies do not authorize scrapes. Setting it only on the app breaks an unconfigured scraper. Older images ignore this variable, so verify anonymous scrapes return 401 after deploying an image with token support.

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

The optional `compose.production.prometheus.yaml` already configures this target and persistent storage. Keep that service private without a published port. With external Prometheus, restrict its Spool queries/scrape targets to the intended Asynq environment; the current metric expressions do not distinguish multiple environments sharing queue names.

Back up the database file and keep the `spool-data` volume. Keep the same Compose project name/resource across redeployments. Do not use `docker compose down -v` unless you intend to delete the audit log, saved views and periodic schedule links.

After updates, rebuild/redeploy and verify `/ready` and the HTTPS login. `/health` only confirms the process is running; `/ready` checks Redis and, when configured, that the SQLite database opens. If startup fails, inspect logs for Redis reachability, a missing or unwritable database directory, or an invalid session key.

### Backups

The database is one file in the `spool-data` volume. For a consistent copy, stop the app (a clean shutdown checkpoints the write-ahead log), copy the file to a private location outside the checkout, then start it again:

```sh
umask 077
mkdir -p "$HOME/spool-backups"
docker compose --env-file .env.installation stop app
docker compose --env-file .env.installation cp app:/data/spool.db \
  "$HOME/spool-backups/spool-$(date +%Y%m%d-%H%M%S).db"
docker compose --env-file .env.installation start app
```

Do not copy the file while the app is running. To restore, stop the app, copy the backup to `/data/spool.db`, remove any leftover `spool.db-wal` and `spool.db-shm` files, and start it again:

```sh
docker compose --env-file .env.installation stop app
docker compose --env-file .env.installation cp "$HOME/spool-backups/spool-YYYYMMDD-HHMMSS.db" app:/data/spool.db
docker compose --env-file .env.installation run --rm --no-deps --user root --entrypoint sh app \
  -c 'rm -f /data/spool.db-wal /data/spool.db-shm && chown spool:spool /data/spool.db'
docker compose --env-file .env.installation start app
```

Check each command's exit status and test a restore periodically. The database file covers the audit log, saved views and schedule links. Back up `.env.installation` separately to retain credentials and project settings. Metrics history lives in the separate Prometheus volume; preserving that volume is necessary to retain it through updates. Tasks remain in your existing Redis and follow that service's backup policy. Use your provider's backup procedure for external Prometheus.

### Upgrading from PostgreSQL

Spool now keeps its data in a SQLite file instead of PostgreSQL. Existing audit log entries, saved views and schedule links are not migrated automatically; the new database starts empty. Tasks live in Redis and are unaffected. The server refuses to start while `DATABASE_URL` is set and asks for `DATABASE_PATH` instead.

- **Guided installations:** rerun `./scripts/install.sh` with the same `--env-file`. It updates the saved configuration: the Compose file list switches to `compose.production.redis.yaml`, and `DATABASE_URL` and `POSTGRES_PASSWORD` are removed.
- **Bundled PostgreSQL:** the `postgres` service is no longer in the Compose files, so its container becomes an orphan of the Compose project and its `postgres-data` volume (for example `spool-production_postgres-data`) is kept. Export what you need before removing them. Find the container with `docker ps -a` and start it if it has stopped:

  ```sh
  umask 077
  mkdir -p "$HOME/spool-backups"
  docker exec spool-production-postgres-1 pg_dump -U spool -d spool \
    > "$HOME/spool-backups/spool-postgres.sql"
  docker exec spool-production-postgres-1 psql -U spool -d spool \
    -c '\copy audit_logs TO STDOUT WITH CSV HEADER' > "$HOME/spool-backups/audit-logs.csv"
  ```

  Then remove the container and volume, and rerun the installer to start Spool again:

  ```sh
  docker compose --env-file .env.installation down --remove-orphans
  docker volume rm spool-production_postgres-data
  ```

- **Manual deployments:** replace `DATABASE_URL` with `DATABASE_PATH` (for example `/data/spool.db`) and mount a writable volume at that directory. If you used `compose.production.external.yaml`, which has been removed, switch `COMPOSE_FILE` or your `-f` arguments to `compose.production.redis.yaml`. Spool no longer connects to an external PostgreSQL database; it is left as it is.

## Connection and account changes

Edit the saved runtime configuration, then rerun the installer with the same `--env-file` to recreate services and recheck readiness. For manual deployments, repeat your original Compose command with the same file list and project name.

- **Administrator password:** update `SPOOL_ADMIN_PASSWORD`. Existing signed sessions remain valid until expiry; also rotate `SPOOL_SESSION_KEY` when you want to invalidate them.
- **Viewer access:** set both `SPOOL_VIEWER_USER` and `SPOOL_VIEWER_PASSWORD`, using a different username from the administrator. Viewers cannot perform task or queue changes.
- **Redis credentials or database:** update `REDIS_URL` and verify the database index against your workers. Switching to a different Asynq environment should use a separate deployment, database and metrics store to keep operational history separate.
- **External metrics:** update `PROMETHEUS_URL`. When switching away from bundled Prometheus, also remove `compose.production.prometheus.yaml` from `COMPOSE_FILE`; the metrics override fixes the URL to the bundled server.

Generated Compose values are single-quoted to keep dollar signs literal. Percent-encode URI credentials containing reserved characters, apostrophes or backslashes. Configuration stays server-side; rebuilding frontend assets with secrets is unnecessary.

## Troubleshooting

Use `docker compose --env-file .env.installation ps` and `docker compose --env-file .env.installation logs --tail 100 app` for guided deployments. Inspect `prometheus` logs only when it is bundled. With a custom configuration path, use it in each command. Logs may include operational details; remove sensitive data before sharing them.

| Symptom | What to check |
| --- | --- |
| Docker is unavailable | Start the Docker daemon and confirm your account can access it; rerun with the saved configuration |
| Setup refuses an existing file | It only reuses files generated by the wizard; use the manual deployment instructions or a new `--env-file` path |
| App cannot become ready | Check Redis reachability from the container network, and that the `/data` volume is mounted and writable by the `spool` user |
| App starts but shows no queues | Use the same Redis database index as the Asynq workers; an empty database can pass readiness |
| Local host port is occupied | Change `SPOOL_HOST_PORT` and the local `SPOOL_INSTALL_URL`, then rerun |
| Sign-in succeeds but does not persist | Match `SPOOL_SECURE_COOKIE` to access mode: HTTPS for remote access, `false` for loopback HTTP |
| Historical charts are empty | Check the Prometheus scrape target and allow samples to accumulate; a successful external query alone does not prove Spool is being scraped |
| Operations are disabled | Check `SPOOL_READ_ONLY`, whether you signed in as a viewer, and whether `DATABASE_PATH` is set |
| External metrics check fails after app startup | Verify the URL, authentication and network access from the app container; services stay running for diagnosis and no bundled fallback is created |

Server readiness excludes Prometheus. The guided installer's final check includes metrics, so it can report a metrics error after Redis and the database are healthy. Correct the configuration and rerun; it preserves credentials and existing data.
