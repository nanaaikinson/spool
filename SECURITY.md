# Security policy

Spool can pause queues and retry, archive, cancel, clone and delete tasks in the Redis your Asynq workers use. Treat it like any other administrative console.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/nanaaikinson/spool/security/advisories/new), not in public issues. Include the version (shown in the sidebar footer or `GET /api/v1/session`), how to reproduce the problem and its impact. You should get an acknowledgement within a week. Fixes are released as a new version and credited in the advisory unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes while Spool is below 1.0.

## Deploying safely

- Require sign-in (`SPOOL_ADMIN_USER` or `SPOOL_VIEWER_USER`) anywhere other than your own machine. Spool refuses to listen on a non-loopback address without it.
- Serve Spool over HTTPS and set `SPOOL_SECURE_COOKIE=true`.
- Use long random values for passwords and `SPOOL_SESSION_KEY` (`openssl rand -hex 32`).
- Keep `/metrics` off public ingress; it is unauthenticated by design for Prometheus.
- Give Spool its own Redis and PostgreSQL credentials, and use `SPOOL_READ_ONLY=true` or a viewer account where people only need to look.
