# Changelog

All notable changes are recorded here. Spool follows [Semantic Versioning](https://semver.org/); while below 1.0, minor versions may include breaking changes, which are called out.

## Unreleased

### Added

- Deployment administrator grants, revocation and atomic handover with current-password verification, session revocation and organization audit entries.
- Operator-only `spool admin recover` for an existing administrator’s password recovery, without Redis or public recovery endpoints.

- Multiple organizations with separate Redis connections, encrypted connection settings, organization-scoped persistence and historical metrics.
- PostgreSQL-backed accounts, admin/operator/viewer RBAC, membership management, account disabling, password resets and session revocation.
- Organization setup in the guided installer, protected browser onboarding and `spool setup` CLI.

- Live connection diagnostics in Settings, verified metrics scrape and warm-up states, and guidance for empty Asynq environments.
- Runtime instance identity and hosted/self-hosted support guidance across sign-in, navigation, Settings and action dialogs.

- Dedicated hosted Compose deployment for Dokploy/Coolify, per-customer credential preparation, and an operator guide.
- Optional `SPOOL_METRICS_TOKEN` bearer authentication on `/metrics`; organization mode and the hosted stack require it; bundled Prometheus configures authenticated scrapes automatically.
- Guided self-hosted installation with generated credentials, bundled PostgreSQL and Prometheus, optional external services, and startup readiness checks.
- Audit log pagination: `GET /api/v1/audit` takes `page` and `limit` (default 25, at most 100) and returns the total; Settings pages through it.
- Account menu in the sidebar footer, holding Settings and Sign out.

### Changed

- Loading states use structure-aware shimmer skeletons (phantom-ui) that match the Dashboard figures, Queues table, task tables and queue page.
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
