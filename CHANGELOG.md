# Changelog

All notable changes are recorded here. Spool follows [Semantic Versioning](https://semver.org/); while below 1.0, minor versions may include breaking changes, which are called out.

## Unreleased

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

### Fixed

- `redis-sentinel://` URLs now use the database number and the Redis master's credentials; previously only the Sentinel password was applied and the database was always 0. Add `sentinel_password` when the Sentinels use a different password.
