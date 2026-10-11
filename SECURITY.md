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
- Give Spool its own Redis credentials, and use `SPOOL_READ_ONLY=true` or a viewer account where people only need to look.
- Restrict access to the SQLite database file and its volume with filesystem permissions; it holds the audit log and Spool's own log lines, whose error details can name internal hosts. The Logs page is served only to the administrator account, and credentials in URLs are redacted before logging.

## Installation credentials and storage

The [guided installer](README.md#install-on-your-own-docker-host) generates separate random administrator and session secrets. It saves them, including connection credentials, in `.env.installation` with owner-only permissions (`600`), and reuses them on reruns. The file is plaintext: restrict access to it and its backups. Do not commit it, include it in support reports, source it as a shell script or pass it to `docker run --env-file`; it uses Compose's dotenv quoting rules.

Configuration is passed to the Go server at runtime. Keep Redis and Prometheus credentials out of frontend configuration, Docker build arguments and baked images. Settings and connection URLs remain server-side. Separate deployments are required for distinct Asynq environments.

The database lives in the `spool-data` named volume; bundled Prometheus has no published host port and uses its own persistent named volume. Database backups contain the audit log and server logs: keep them private. Without `SPOOL_METRICS_TOKEN`, the scrape path is unauthenticated even when the console requires sign-in. External Prometheus must contain only the intended environment's Asynq metrics; current queries do not isolate multiple environments sharing queue names.

After changing credentials, redeploy with the same configuration file and project name. Rotate `SPOOL_SESSION_KEY` to invalidate existing signed sessions. See [connection and account changes](docs/deployment.md#connection-and-account-changes) for the procedure.

Instance identity and support metadata are intentionally public on the sign-in screen. Use only public names and HTTPS/mailto support links without embedded credentials. Connection diagnostics require the same sign-in as other console APIs and return fixed messages rather than connection URLs, upstream errors or Prometheus target labels.
