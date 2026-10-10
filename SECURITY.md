# Security policy

Spool can pause queues and retry, archive, cancel, clone and delete tasks in the Redis your Asynq workers use. Treat it like any other administrative console.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/nanaaikinson/spool/security/advisories/new), not in public issues. Include the version (shown in the sidebar footer or `GET /api/v1/session`), how to reproduce the problem and its impact. You should get an acknowledgement within a week. Fixes are released as a new version and credited in the advisory unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes while Spool is below 1.0.

## Deploying safely

- Require sign-in through managed accounts or configured legacy accounts anywhere other than your own machine. Spool refuses non-loopback access without configured legacy accounts or protected organization setup with a signing key. Organization mode requires PostgreSQL and an independent encryption key.
- For remote browser access, serve Spool over HTTPS and set `SPOOL_SECURE_COOKIE=true`. The guided installer's local HTTP option disables secure cookies and binds the host port to loopback; use it on your own machine or through an SSH tunnel.
- Use long random values for passwords and `SPOOL_SESSION_KEY` (`openssl rand -hex 32`).
- Keep `/metrics` off public ingress when no scrape token is configured. `SPOOL_METRICS_TOKEN` requires bearer authentication on that path; use an independent random token of at least 32 characters without whitespace. It does not grant access to console APIs.
- Give Spool its own Redis and PostgreSQL credentials, and use `SPOOL_READ_ONLY=true` or a viewer account where people only need to look.

## Installation credentials and storage

The [guided installer](docs/deployment.md#guided-installation-on-your-own-docker-host) generates separate random administrator, PostgreSQL, session, encryption, setup and scrape secrets. It saves them, including connection credentials, in `.env.installation` with owner-only permissions (`600`), and reuses them on reruns. The file is plaintext: restrict access to it and its backups. Do not commit it, include it in support reports, source it as a shell script or pass it to `docker run --env-file`; it uses Compose's dotenv quoting rules.

Configuration is passed to the Go server at runtime. Keep Redis, PostgreSQL and Prometheus credentials out of frontend configuration, Docker build arguments and baked images. Stored connection settings are never returned to the browser. Deployment administrators can submit connection credentials in write-only forms. Multiple organizations can share a deployment; their Redis connections, task reads, audit logs, views, schedule links and historical queries are organization scoped.

Bundled PostgreSQL and Prometheus have no published host ports and use persistent named volumes. Organization mode requires `SPOOL_METRICS_TOKEN`; console cookies never authorize the combined export. Legacy mode can omit it, leaving the scrape path unauthenticated even when the console requires sign-in. Legacy external Prometheus must contain only the intended environment’s Asynq metrics. Organization-mode queries require the native `organization` label plus the deployment scrape job and never fall back to unscoped samples.

The [dedicated hosted stack](docs/hosting.md) requires a separate scrape token and configures its own private Prometheus. Each customer resource has separate accounts, secrets, storage and networks. Generated runtime files under `deployments/` are plaintext with owner-only permissions and must be handled like the self-hosted installation file. Separate containers on a shared host do not provide VM isolation; deploy to separate servers when that isolation is required. Verify anonymous `/metrics` returns 401 before onboarding: older images do not implement the token setting.

After changing credentials, redeploy with the same configuration file and project name. Rotating `POSTGRES_PASSWORD` in an environment file does not change an existing PostgreSQL role: change the role's password and the application configuration together. Rotate `SPOOL_SESSION_KEY` to invalidate existing signed sessions. See [connection and account changes](docs/deployment.md#connection-and-account-changes) for the procedure.

Instance identity and support metadata are intentionally public on the sign-in screen. Use only public names and HTTPS/mailto support links without embedded credentials. Connection diagnostics require the same sign-in as other console APIs and return fixed messages rather than connection URLs, upstream errors or Prometheus target labels.

## Organization accounts

New guided and hosted preparation enables `SPOOL_MULTI_ORG`. Bootstrap is protected by a private setup token or preconfigured administrator credentials; the first-user check is transactional and serialized. There is no public registration. Passwords use bcrypt (12–72 bytes), and account disabling/password changes revoke all existing sessions for that account. Roles and membership are resolved on each request; removing a membership closes live access on the next stream update. Identity writes enforce the last active organization/deployment administrator under a database lock and record audit entries in the same transaction.

The first account is a deployment administrator and can access all organizations. Organization administrators cannot manage deployment accounts or connection URLs. Treat deployment administrator access as infrastructure access, including network access to operator-selected Redis and Prometheus endpoints. Application scoping is not independent process/host isolation; use separate hosted resources or servers where required.

Connection credentials are AES-GCM encrypted with organization IDs as authenticated data. Keep `SPOOL_DATA_KEY` stable and backed up separately; changing it prevents connection decryption and fails startup. Env-file bootstrap credentials remain plaintext and must stay private. See [setup, roles and migration](docs/organizations.md).
