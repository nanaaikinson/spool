# Organizations, users and access

An organization connects to one Asynq Redis database. A deployment can contain multiple organizations, each with its own members and roles, task data, audit log, saved views, periodic schedule links and historical metrics. Tasks remain in Redis. PostgreSQL stores accounts, organizations, encrypted connection settings and operational metadata.

## First setup

The normal `./scripts/install.sh` wizard asks for an organization name and administrator username, generates a password, and enables `SPOOL_MULTI_ORG=true`. At startup, Spool creates that organization and account only if the database has no users. Read the generated credentials privately from `.env.installation`, then sign in. The organization’s initial Redis URL comes from the installer.

For browser onboarding, run:

```sh
./scripts/install.sh --browser-setup
```

Open the console and enter the private `SPOOL_SETUP_TOKEN` from the generated file, your organization name, administrator username and password. Leave Redis blank to use the deployment’s configured connection, or supply a different connection. Setup creates the first organization and deployment administrator together, then shows sign-in. A valid token cannot run setup a second time. Concurrent first-setup attempts cannot create competing administrators.

For Dokploy/Coolify, `scripts/prepare-hosted.py` enables the same mode. Use `--organization-name "Acme team"` with the normal bootstrap, or `--browser-setup` to let the first administrator choose the organization and account in the browser. Transfer the setup token through a private channel.

Manual runtime configuration needs:

| Variable | Purpose |
| --- | --- |
| `SPOOL_MULTI_ORG=true` | Enable persistent accounts and multiple organizations |
| `DATABASE_URL` | PostgreSQL for accounts, memberships and operational metadata |
| `SPOOL_METRICS_TOKEN` | Independent random scrape token, at least 32 characters; protects the combined export |
| `SPOOL_SESSION_KEY` | Independent random signing secret, at least 32 characters |
| `SPOOL_DATA_KEY` | Independent stable encryption secret, at least 32 characters |
| `SPOOL_SETUP_TOKEN` | Independent random first-setup token, at least 32 characters; required without env bootstrap credentials |
| `SPOOL_ADMIN_USER` / `SPOOL_ADMIN_PASSWORD` | Optional bootstrap account; set both, or leave both empty for UI/CLI API setup |
| `SPOOL_ORGANIZATION_NAME` | Initial name when using env bootstrap, default `My organization` |
| `REDIS_URL` | Initial Redis connection; browser/CLI setup can override it |

Generate independent secrets with `openssl rand -hex 32`. Managed passwords must be 12–72 bytes. Usernames are case-sensitive ASCII letters, digits, dots, underscores, hyphens and `@`, with at most 80 characters. Browser/CLI API setup requires writable mode. Use HTTPS and secure cookies for remote browser access.

### CLI setup

The built server binary contains the same protected setup client. It reads one JSON object from stdin so passwords and tokens need not appear in process arguments:

```sh
umask 077
# Create private-setup.json with your editor, replacing the placeholders below.
bin/spool setup --url https://spool.example.com < private-setup.json
# From a running Compose app, use its loopback URL:
docker compose --env-file .env.installation exec -T app \
  /app/spool setup --url http://127.0.0.1:8080 < private-setup.json
```

```json
{
  "token": "PRIVATE_SETUP_TOKEN",
  "username": "admin",
  "password": "PRIVATE_LONG_PASSWORD",
  "organization": {
    "name": "Acme team",
    "redis_url": "",
    "prometheus_url": ""
  }
}
```

Blank connection fields use the deployment defaults. The client accepts HTTPS or loopback HTTP and refuses redirects. CLI and UI both call `POST /api/v1/setup`; setup and env bootstrap use the same transactional store implementation. Keep the JSON file private and remove it when your credential-storage policy permits.

## Roles and user management

| Capability | Viewer | Operator | Organization admin | Deployment administrator |
| --- | --- | --- | --- | --- |
| Read queues, tasks, workers, schedules, charts and audit | Own organizations | Own organizations | Own organizations | All organizations |
| Queue/task actions, save/delete own views | No | Yes | Yes | Yes |
| Rename organization, add/remove members, change roles | No | No | Own organizations | All organizations |
| Create organizations or replace connections | No | No | No | Yes |
| List all accounts, disable/enable accounts, reset others’ passwords | No | No | No | Yes |
| Change own password | Yes | Yes | Yes | Yes |

The first account is the deployment administrator. This is deployment-wide authority, separate from membership roles; changing its membership does not remove deployment authority. New accounts created through membership forms receive only their organization role. There is no public registration, SSO, invitation email or billing workflow.

In Settings → Organization members, add a username and role. Supply a password to create a new account; leave it empty to add an existing user. Adding an existing user never changes their password. Roles can differ between organizations. Role changes and removals take effect on subsequent API requests; action requests already running may finish. At least one active member with the admin role must remain in each organization.

Deployment accounts lists global accounts. Disable an account to revoke all its sessions and prevent sign-in across organizations; enable it to restore sign-in. Resetting a password also revokes all sessions. The last active deployment administrator cannot be disabled. Ordinary users change their own password with their current password and are returned to sign-in. Account and membership changes are audited transactionally without storing passwords or hashes in the audit log.

Use the sidebar organization selector to switch. The UI navigates to the dashboard, clearing prior caches, pending requests, drafts and live subscriptions. Selection is stored per tab and explicitly attached to API and event-stream requests; changing another tab’s shared session cookie cannot redirect this tab’s task actions. Users with no memberships can sign in to request access and change their password, but cannot inspect operational data.

## Connections and metrics

Deployment administrators create organizations with a Redis URL in Settings. Redis and Prometheus URLs are write-only: stored credentials are never returned or prefilled. To rotate an organization’s credentials, use Replace connection and supply the complete replacement. Empty Prometheus means the deployment’s configured Prometheus. Connection changes take effect on new requests without redeploying. Credential rotations retain schedule links; changing the Redis destination or database clears the selected organization’s links so reused task IDs cannot inherit another environment’s schedule. Audit, saved views and historical samples remain associated with the organization. Create a new organization when that history should be separate. Creation accepts an offline connection; verify its reachability in that organization’s Settings before handing it over.

Supported organization Redis URLs are `redis://`, `rediss://` and `redis-sentinel://`. Use TLS on public networks or an operator-approved private route; the UI does not establish a VPN or allowlist network destinations. Redis Cluster and per-organization Unix sockets are unsupported. Mounted `REDIS_TLS_*` trust/client settings are deployment-wide and apply to all organization connections; use separate deployments for different client-certificate identities. Deployment administrators are trusted to choose infrastructure endpoints. Organization administrators cannot enter arbitrary connection URLs.

The native `/metrics` exporter adds `organization="ORGANIZATION_ID"` to every organization’s Asynq metric. Bundled Prometheus scrapes all organizations through the existing private endpoint using the independent scrape token. Organization mode requires this token, and console cookies cannot authorize the combined export. Chart queries filter both that label and the deployment’s `SPOOL_METRICS_JOB`; shared queue names cannot merge organizations. External collectors must supply the same organization label and job. Unlabelled historical samples from legacy mode are not returned in organization mode. Go/process and request metrics remain deployment-wide.

`/ready` checks PostgreSQL in this mode so one customer’s unreachable Redis does not stop every organization’s console or block first setup. Settings checks the selected organization’s Redis and metrics. Prometheus target/scrape health describes the deployment’s scrape job, while Redis health and chart data are organization-specific. The exporter skips failed organization reads; it does not substitute another connection. Use separate dedicated resources for independent failure domains, storage, networks or host isolation.

## Upgrading an existing installation

1. Back up PostgreSQL and retain the existing Compose project, database and volumes.
2. Generate independent `SPOOL_DATA_KEY` and `SPOOL_METRICS_TOKEN` secrets, preserve the existing session key, and set `SPOOL_MULTI_ORG=true` plus `SPOOL_ORGANIZATION_NAME`. Keep the original admin credentials for the first bootstrap, or configure a setup token and leave admin fields empty.
3. Deploy this release. Migrations add organization columns and composite schedule keys without mirroring or deleting tasks. First setup adopts the legacy audit log, views and schedule links into the initial organization. Saved-view actor ownership remains unchanged; legacy views belonging to `local` do not automatically become the new administrator’s views.
4. Sign in, verify that organization’s queues and retained records, then create additional organizations and members.

Environment passwords and `REDIS_URL` are bootstrap-only once managed accounts exist. Changing them does not reset users or replace stored organization connections. Initial viewer environment credentials are imported only during env administrator bootstrap. Continue using managed mode after migration: startup refuses legacy mode against a database containing managed accounts. Existing legacy cookies cannot authenticate as database-backed users; sign in again.

Back up PostgreSQL and the **original data key separately**. A database backup alone cannot decrypt stored connections. Restore the same data key and rotate the session signing key to revoke restored sessions. Do not rotate the data key in place: this release does not provide connection re-encryption. Startup fails safely if the configured key cannot decrypt stored connections. After successful setup you may remove the setup token and bootstrap account variables. Startup requires a token or bootstrap administrator only while the database has no users. Retaining the private token is also safe because setup refuses a nonempty user database.
