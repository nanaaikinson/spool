# Security policy

Spool can pause queues and retry, archive, cancel, clone and delete tasks in the Redis your Asynq workers use. Treat it like any other administrative console.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/nanaaikinson/spool/security/advisories/new), not in public issues. Include the version (shown in the sidebar footer or `GET /api/v1/session`), how to reproduce the problem and its impact. You should get an acknowledgement within a week. Fixes are released as a new version and credited in the advisory unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes while Spool is below 1.0.

## Deploying safely

- Require sign-in (`SPOOL_ADMIN_USER` or `SPOOL_VIEWER_USER`) anywhere other than your own machine. Spool refuses to listen on a non-loopback address without it.
- For remote browser access, serve Spool over HTTPS and set `SPOOL_SECURE_COOKIE=true`. The guided installer's local HTTP option disables secure cookies and binds the host port to loopback; use it on your own machine or through an SSH tunnel.
- Use long random values for passwords and `SPOOL_SESSION_KEY` (`openssl rand -hex 32`).
- Keep `/metrics` off public ingress when no scrape token is configured. `SPOOL_METRICS_TOKEN` requires bearer authentication on that path; use an independent random token of at least 32 characters without whitespace. It does not grant access to console APIs.
- Give Spool its own Redis and PostgreSQL credentials, and use `SPOOL_READ_ONLY=true` or a viewer account where people only need to look.

## Installation credentials and storage

The [guided installer](docs/deployment.md#guided-installation-on-your-own-docker-host) generates separate random administrator, PostgreSQL and session secrets. It saves them, including connection credentials, in `.env.installation` with owner-only permissions (`600`), and reuses them on reruns. The file is plaintext: restrict access to it and its backups. Do not commit it, include it in support reports, source it as a shell script or pass it to `docker run --env-file`; it uses Compose's dotenv quoting rules.

Configuration is passed to the Go server at runtime. Keep Redis, PostgreSQL and Prometheus credentials out of frontend configuration, Docker build arguments and baked images. Settings and connection URLs remain server-side. Separate deployments are required for distinct Asynq environments.

Bundled PostgreSQL and Prometheus have no published host ports and use persistent named volumes. Without `SPOOL_METRICS_TOKEN`, the scrape path is unauthenticated even when the console requires sign-in. External Prometheus must contain only the intended environment's Asynq metrics; current queries do not isolate multiple environments sharing queue names.

After changing credentials, redeploy with the same configuration file and project name. Rotating `POSTGRES_PASSWORD` in an environment file does not change an existing PostgreSQL role: change the role's password and the application configuration together. Rotate `SPOOL_SESSION_KEY` to invalidate existing signed sessions. See [connection and account changes](docs/deployment.md#connection-and-account-changes) for the procedure.

Instance identity and support metadata are intentionally public on the sign-in screen. Use only public names and HTTPS/mailto support links without embedded credentials. Connection diagnostics require the same sign-in as other console APIs and return fixed messages rather than connection URLs, upstream errors or Prometheus target labels.
