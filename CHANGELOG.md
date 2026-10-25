# Changelog

All notable changes are recorded here. Spool follows [Semantic Versioning](https://semver.org/); while below 1.0, minor versions may include breaking changes, which are called out.

## Unreleased

### Added

- Enqueue history for periodic schedules: a History button on each entry lists the newest tasks it enqueued, with links to the tasks. It comes from Asynq's own record, which clears when the scheduler shuts down cleanly. Served by `GET /api/v1/schedulers/{id}/events`.
- Delete an empty queue from its page. Spool never forces it, so a queue with any task, retained or not, is refused. Served by `DELETE /api/v1/queues/{queue}`.
- Retry, archive or delete every task in one state of a queue from All tasks, beyond the 50 a selection allows. It asks for confirmation (deletes also ask you to type the queue name), never touches active tasks, and is one audit entry such as `delete_all_retry`. Served by `POST /api/v1/queues/{queue}/tasks/bulk`.
- Redis page under Infrastructure: version, mode and role, uptime, memory use against any limit, clients, keys, command rate, traffic counters, keyspace hit rate, and snapshot, append-only file and replica status, refreshed every 10 seconds. The page shows a fixed selection of the Redis `INFO` output with no configuration, hostnames or paths. The administrator account also gets the full `INFO` output and, on Redis Cluster, the hash slot and nodes holding each queue. Served by `GET /api/v1/redis`, `/redis/raw` and `/redis/cluster`.
- Logs page for the administrator account: Spool's own log lines (startup, sign-ins, queue and task actions, warnings and errors; not per-request lines) with search (`level:error -healthcheck code:DEPENDENCY_*`), 15m/1h/24h/7d and custom ranges, a stacked level histogram (click a bar to jump the list to that time, Shift-click to zoom), live tail, table and JSON views, a virtualized list that loads older lines while scrolling (up to 5,000) and newer lines on request, keyboard shortcuts (`/` search, `j`/`k` move, Esc close), and a detail panel with lines around, same message, copy JSON, copy for AI and copy link. Served by `GET /api/v1/logs` and `GET /api/v1/logs/histogram`.
- `SPOOL_LOG_RETENTION` (default `3d`) sets how long log lines are kept; an hourly job removes older ones.
- Log lines include a `caller` with the file and line, and `/metrics` adds `spool_log_events_total` by level.
- Live connection diagnostics in Settings, verified metrics scrape and warm-up states, and guidance for empty Asynq environments.
- Runtime instance identity and support guidance across sign-in, navigation, Settings and action dialogs.
- Optional `SPOOL_METRICS_TOKEN` bearer authentication on `/metrics`.
- Guided self-hosted installation with generated credentials, a persistent database volume, bundled or external Prometheus, and startup readiness checks.
- Audit log pagination: `GET /api/v1/audit` takes `page` and `limit` (default 25, at most 100) and returns the total; Settings pages through it.
- Account menu in the sidebar footer, holding Settings and Sign out.

### Changed

- **Breaking:** Spool stores the audit log, saved views and schedule links in SQLite instead of PostgreSQL. Set `DATABASE_PATH` to a file on persistent storage (the Compose files use `/data/spool.db` in the `spool-data` volume); Spool refuses to start while `DATABASE_URL` is still set. Existing PostgreSQL data is not migrated. `compose.production.external.yaml` and `.env.production.external.example` are removed; rerunning `scripts/install.sh` updates saved installations. Run one Spool instance per database file. See [upgrading from PostgreSQL](docs/deployment.md#upgrading-from-postgresql).
- Loading states use structure-aware shimmer skeletons (phantom-ui) that match the Dashboard figures, Queues table, task tables and queue page.
- The web UI uses TanStack Router file-based routes (one file per page in `apps/web/src/routes`), with each page code-split.
- The web UI uses Tailwind utilities and shared page components instead of a custom stylesheet, and Base UI instead of Radix for its primitives.
- Query parameters are validated against the API contract, so out-of-range or malformed values return `422 VALIDATION_ERROR` naming the parameter. Invalid metric `step`, `start` or `end` values now return `VALIDATION_ERROR` instead of `INVALID_RANGE`.

## 0.1.0 (2026-10-10)

First public release.

### Added

- Dashboard with needs-attention checks and top error groups.
- Live activity: running tasks, what runs next, and a tail of starts and finishes.
- Metrics from Asynq's Prometheus collector, with a live mode.
- Queues, All tasks, Scheduled and Failed views with payload and error inspection, retry, archive, delete, cancel, clone, bulk actions and saved views.
- Servers page and periodic schedules with plain-English cron descriptions; tasks link to the schedule that enqueued them, persisted in PostgreSQL.
- Admin and viewer accounts, read-only mode and an audit log of every action.
- Read-only mode is turned on automatically when `DATABASE_URL` is not set.
- `REDIS_TLS_CA_FILE`, `REDIS_TLS_CERT_FILE` and `REDIS_TLS_KEY_FILE` for Redis behind a private CA or requiring client certificates.
- Startup check that reports when Redis can't be reached or has no Asynq queues in the configured database.
- Multi-architecture container images published to GitHub Container Registry on each release.
- Spool logo, favicons, app icons and web manifest, and a dedicated sign-in screen.

### Fixed

- `redis-sentinel://` URLs now use the database number and the Redis master's credentials; previously only the Sentinel password was applied and the database was always 0. Add `sentinel_password` when the Sentinels use a different password.

### Security

- Development dependency `js-yaml` (used by the API client generator) is pinned to 4.3.2 or later to clear three CPU-exhaustion advisories.
