# Dedicated hosted Spool

Dokploy and Coolify can operate the first hosted offering. Deploy one `compose.hosted.yaml` resource per customer and Asynq environment, using a tested Spool image. Operators handle onboarding, secrets, DNS, backups and upgrades in the platform. Customers supply their existing Asynq Redis connection before provisioning, then sign in to their own HTTPS console. They do not supply PostgreSQL or Prometheus credentials: this stack provisions those services.

This repository provides the deployment and operating procedures. It does not yet provide a signup portal, billing, automated platform provisioning, SSO or a customer-side connector. New prepared resources enable PostgreSQL-backed accounts and admin/operator/viewer organization roles. A resource can host multiple organizations; its first account is a deployment administrator. A marketing site or billing service can be added without changing how tasks are read.

Live Dokploy/Coolify validation is tracked in the [backlog](backlog.md). Until a destination is available, use the hosted rehearsal below or the [local organization/RBAC stack](testing.md).

## Isolation and prerequisites

| Resource | Per customer |
| --- | --- |
| Spool app | Separate container, accounts, signing key and scrape token |
| PostgreSQL | Separate service, credentials and persistent volume for audit, views and schedule links |
| Prometheus | Separate service and volume; 15-day retention capped at 2 GB |
| Redis | Customer-owned Asynq Redis, accessed directly; tasks are never mirrored into PostgreSQL |
| Domain | Separate HTTPS hostname routed to that customer's app on port 8003 |

Separate Compose resources scope network and volume names. The template has no global container names, host ports or external shared volumes. PostgreSQL and Prometheus attach only to the internal `storage` network; the app also joins the resource's default network for Redis egress and platform proxy access. Avoid attaching storage services to a platform-wide network. Review the platform's final rendered Compose definition before deployment.

Containers on the same server share its kernel and the operator's Docker access. If selling a dedicated **server**, provision a separate VM/server per customer and select it as the platform destination. A separate Compose resource on a shared server is a dedicated application stack, not a dedicated VM. Plan capacity for the three containers, disks, backups and the platform itself; the default limits are 512 MB and one CPU per service and can be adjusted through `SPOOL_APP_*`, `SPOOL_POSTGRES_*` and `SPOOL_PROMETHEUS_*` memory/CPU variables.

You need an operational Dokploy or Coolify server, DNS and HTTPS access, registry access to the chosen Spool image, Python 3 and Docker Compose on the operator machine, and network access from the deployment server to customer Redis. The platform hosts the whole Go image, including the built React assets; Vite is not a separate production service.

## Prepare a customer

Before provisioning the first customer, rehearse the chosen image locally:

```sh
# For an image built from this checkout:
docker build -t spool:hosted-pilot .
make smoke-hosted HOSTED_IMAGE=spool:hosted-pilot
# Or use a tested registry image directly as HOSTED_IMAGE.
```

The rehearsal requires Python 3, OpenSSL and Docker Compose supporting `up --wait`. It extends the actual hosted Compose definition with disposable Redis and an HTTPS proxy, uses a temporary trusted certificate for both HTTPS and Redis TLS, and never reads your deployment configuration or customer Redis. It checks the built UI, secure sessions, live events, metrics protection and collection, redeployment, a logical PostgreSQL dump restored into an empty database, and administrator recovery through the container CLI. Restore checks cover accounts, audit entries, saved views, organization metadata and encrypted Redis connections. Its random project, loopback-only proxy port, containers, networks and volumes are removed on completion; the selected image is retained. CI runs this rehearsal before release checks can pass. This is a local rehearsal; DNS, platform routing, off-host backups and actual customer connectivity must still be verified on the destination.

1. Agree on a region, environment, unique customer slug and hostname. Record the platform resource/destination, image digest, approved Redis endpoint/database, owner and backup policy in your operator inventory. Keep passwords in the secret store, not the inventory.
2. Obtain a dedicated Redis credential through a secure channel. Confirm the database index matches the customer's workers, verify Asynq v0.26 compatibility, and approve network access from the destination. Use `rediss://` with certificate verification or an approved private connection. Do not expose plaintext Redis to the internet. A read-only Spool role still uses Asynq Inspector's Redis commands; test ACL compatibility, including Lua scripting.
3. Set `SPOOL_RELEASE_IMAGE` to a tested full release tag or SHA-256 digest, then prepare credentials:

   ```sh
   # Set this to your tested registry image containing the hosted support.
   python3 scripts/prepare-hosted.py acme --image "$SPOOL_RELEASE_IMAGE" \
     --instance-name "Acme operations" --environment production \
     --support-url https://support.example.com/spool
   ```

   The name and support link are public metadata, including on the sign-in screen. The environment defaults to `production`; the name defaults to the customer slug. The template sets `SPOOL_DEPLOYMENT_MODE=hosted`, and the UI displays the instance name and environment in navigation and action dialogs. The prompt hides the Redis URI. For noninteractive preparation, use `--redis-url-file /path/to/private/redis-uri`; keep that input file owner-only. For approved plaintext private networking, add `--private-redis`. That flag records your choice at preparation time; it does not establish a VPN or a private route.
4. Transfer the values from `deployments/acme/.env.hosted` into the resource's runtime environment. Compose dotenv values are single-quoted to preserve literal credential characters. In a platform key/value editor, enter the values without the enclosing quotes; a dotenv editor can accept the file's contents. Verify literal `$` characters survive the platform parser, or percent-encode them in Redis URI credentials.

The command generates independent random admin, database, session, data-encryption, setup and metrics secrets. `--organization-name` names the first organization; `--browser-setup` leaves bootstrap account fields empty so the customer sets up the organization and account with the private setup token. Preserve `SPOOL_DATA_KEY` across all upgrades and restores. It validates the actual Compose template without starting containers or contacting Redis, writes a mode-600 file inside a mode-700 customer directory, and refuses to replace an existing configuration. Reuse that file for redeployment; editing passwords alone cannot reset an existing PostgreSQL role. Generated customer files are ignored by Git and excluded from Docker builds. The file remains plaintext and needs restricted storage and backups. Never source it as shell code or include it in support reports.

Pin an image built from code that implements `SPOOL_METRICS_TOKEN`. Older releases ignore this variable and expose `/metrics`; a successful deployment alone does not establish token support. Publish a release containing these changes, or build and push your own image from this checkout, before onboarding customers. Full version tags are accepted by the preparation command; a registry digest also protects against later tag replacement. Do not use `latest` or a moving minor tag.

For private CAs or mutual TLS, add platform-managed read-only certificate mounts to **app**, explicitly pass `REDIS_TLS_CA_FILE` and optionally `REDIS_TLS_CERT_FILE`/`REDIS_TLS_KEY_FILE` in its `environment`, and use container paths. The stock hosted preparation command supports direct `redis://`/`rediss://` connections. Sentinel needs a reviewed custom definition and TLS configuration; Redis Cluster is unsupported. See [connection details](deployment.md#connection-values).

## Dokploy

1. Create a separate project/resource for this customer on the chosen server. Select **Docker Compose** mode, connect the repository at a reviewed ref, and set the Compose path to `compose.hosted.yaml`. You can also paste the standalone definition into a Compose resource. Use Compose mode rather than Swarm Stack for this tested template.
2. In **Environment**, enter the prepared runtime values. The template explicitly interpolates each required variable; no `env_file` mount or source build is needed. Configure registry credentials if the image is private.
3. In **Domains**, select service **app**, path `/`, container port **8003**, and enable HTTPS. Point DNS to the destination. Do not add domains or ports for PostgreSQL or Prometheus.
4. Review generated networks/volumes and deploy. Preserve this resource's project identity across redeployments. AutoDeploy should follow a controlled release ref; avoid deploying unreviewed changes to every customer at once.

The Prometheus configuration is generated inside its container, so this definition needs no repository bind mounts or File Mounts. See [Dokploy's Compose guide](https://docs.dokploy.com/docs/core/docker-compose) and [domain settings](https://docs.dokploy.com/docs/core/docker-compose/domains).

## Coolify

1. Create a separate customer resource from the Git repository with the **Docker Compose** build pack. Set Base Directory to `/` and Docker Compose Location to `/compose.hosted.yaml`. Alternatively, use **Docker Compose Empty** and paste the definition; that service has no Git automation.
2. Load the definition and fill the required **Environment Variables** with prepared values. Configure access to a private registry if needed.
3. Give service **app** the domain `https://acme.spool.example.com:8003`. The port suffix selects the internal container port; visitors use HTTPS on 443. Leave the other services without domains.
4. Keep **Raw Compose Deployment** disabled so Coolify manages proxy routing. Do not enable a shared predefined network for the storage services. Review the generated definition and deploy.

The template pulls an image, uses named volumes, and generates Prometheus configuration internally. It does not require preserving the repository for file mounts. See [Coolify's Compose guide](https://coolify.io/docs/applications/builds/docker-compose).

## Verify before handing over access

After account setup, create an owner-only `deployments/acme/private-pilot.json` in your editor with the pilot account credentials. Keep it in the prepared customer directory, which is ignored by Git and excluded from Docker builds:

```json
{"username": "admin", "password": "PRIVATE_PILOT_ACCOUNT_PASSWORD"}
```

```sh
chmod 600 deployments/acme/private-pilot.json
python3 scripts/check_hosted.py \
  --url https://acme.spool.example.com \
  --credentials-file deployments/acme/private-pilot.json \
  --instance-name "Acme operations"
```

This check verifies HTTPS certificates, the expected public identity, built frontend assets, unauthenticated API denial, metrics denial without a valid token, sign-in, secure session cookies, organization access, live events, Redis/PostgreSQL connectivity, and successful Prometheus scraping. It waits up to 90 seconds for initial collection and signs out its own session. A viewer account with membership is sufficient; it makes no task or configuration changes. Use `--organization-id ID` to check each additional organization, `--wait-seconds 180` for slower initial scrapes, and `--ca-file /path/to/trusted-ca.pem` for an approved private HTTPS CA. TLS verification is never disabled, redirects are rejected, and credentials stay out of arguments and output. Do not include the input file in support reports.

A passing automated check covers the console path. Complete the platform isolation, real queue/database selection, backup and customer handover checks below as well. Record the checked image digest, platform resource, timestamp and outcomes in your operator inventory.

- Open Settings and verify the three connection checks. Its Prometheus check must show collecting, not just reachable. Test the support link and friendly instance identity.
- Confirm all three services are healthy. In organization mode, `/ready` checks PostgreSQL so an unavailable organization Redis does not stop the whole console; it does not check Prometheus. Check each organization’s Redis and metrics separately in Settings. Legacy mode also checks Redis in `/ready`.
- Open the HTTPS hostname and sign in. Confirm the intended environment and queues appear, secure session cookies work, and live events stream through the proxy. An empty queue list can mean the wrong Redis database; confirm with the customer.
- Request the public `/metrics` path without credentials and require **401**. Also check it using a wrong token. A **200** means the wrong/older image or missing runtime configuration; stop onboarding until corrected. Only the dedicated bearer token grants scrape access, and it never grants console API access.
- In the platform's private **prometheus** terminal, run `wget -qO- http://127.0.0.1:9090/api/v1/targets` and require the Spool target's health to be `up`. Token authentication is configured through Prometheus's [authorization credentials file](https://prometheus.io/docs/prometheus/latest/configuration/configuration/). Check charts after samples accumulate; earlier history is not reconstructed.
- Take and restore the first PostgreSQL backup in a disposable resource. Confirm restored audit entries and saved views. Test upgrades in that resource before enabling them for customers.

Deliver the console URL, account credentials and support contact through your agreed secure channel. Use Settings → Organization members to create viewer or operator accounts, or add existing accounts to another organization. Env account fields only bootstrap a new database. On a resource shared by unrelated customers, retain deployment administration as the operator and give customers organization roles. On a dedicated customer resource, transfer deployment administration to its designated owner only when the owner should control all organizations in that resource. See [organization setup and RBAC](organizations.md). Use `SPOOL_READ_ONLY=true` if actions should be disabled for everyone. Do not share platform admin access or backend connection secrets with ordinary console users.

## Operate, back up and upgrade

Monitor destination disk space, container health/restarts, PostgreSQL availability, Prometheus target health and customer connectivity. Logs are rotated at 10 MB with three files per container; Prometheus samples are limited by both age and size. Neither bounds PostgreSQL growth. Agree on an audit retention policy and monitor disk use before it fills.

Configure an off-host encrypted PostgreSQL backup schedule before customer handover, with a stated retention period and a restore drill. Use a logical `pg_dump -Fc` from the private PostgreSQL service for live backups; copying its running data volume alone is not a consistent database backup. Platform volume backup facilities can preserve Prometheus data when required, but PostgreSQL requires a consistent database backup procedure. Preserve runtime credentials, especially the original data-encryption key, separately in the operator secret store. A PostgreSQL backup without that key cannot decrypt organization connections.

For an operator with Docker access to the destination, use the platform's **actual** Compose project name (it may differ from the customer slug):

```sh
python3 scripts/backup_hosted.py \
  --project "$PLATFORM_PROJECT" \
  --output-dir /path/to/private/backups/acme
```

The backup command requires exactly one running `postgres` service with the requested project labels; it never guesses a customer from the current directory or `.env`. It creates a mode-700 directory and mode-600 files, refusing an existing shared directory or symlink. It publishes the custom-format `.dump` only after `pg_dump` succeeds and the accompanying `.dump.sha256` checksum is complete. Failed dumps are removed, upstream errors stay out of output, and later runs create new UTC-named files without replacing older backups. It performs no database writes and does not contact customer Redis. The hosted rehearsal restores a backup made with this same command.

Schedule the command under an operator account on the destination and alert on its nonzero exit status. Upload completed dumps and checksums to the approved encrypted off-host backup destination, applying your agreed retention period; the command creates a local plaintext dump and checksum. Do not keep the only copy on the application server, and preserve runtime secrets separately. After downloading a backup, verify its checksum before restoring: on Linux run `sha256sum --check BACKUP.dump.sha256` from the backup directory, substituting the generated filename.

For restoration, provision a disposable customer stack, stop **app** to prevent writes, and run `pg_restore --exit-on-error --clean --if-exists --no-owner -U spool -d spool` inside its PostgreSQL container with the verified dump on stdin. Preserve the original `SPOOL_DATA_KEY`, start app, and verify accounts, organization connections, audit entries, saved views, readiness and scrape health. See [database backup details](deployment.md#metrics-persistence-and-updates).

Upgrade a canary resource first, take a fresh backup, set `SPOOL_IMAGE` to the tested full tag/digest, and redeploy the same resource. Record the old image digest and preserve volumes and signing keys. Migrations run on app startup. Rolling back the app image is safe only when its schema remains compatible; otherwise restore the matching database backup into a replacement resource and account for writes since that backup. Do not delete volumes as part of a routine redeployment.

Use Settings → Deployment accounts to grant, remove or transfer deployment administration with current-password verification. For a forgotten sole administrator password, use the [operator recovery CLI](organizations.md#recover-a-deployment-administrator). Reset managed console passwords or disable accounts in Settings; those changes revoke that account’s sessions. Environment passwords do not reset managed accounts. Rotate the signing key to revoke all sessions; preserve the independent data key. Replace Redis credentials in the selected organization’s Settings, rather than editing the original bootstrap REDIS_URL. Rotate the metrics token in both app and Prometheus together. PostgreSQL role password changes must be coordinated with the app's connection URI; changing `POSTGRES_PASSWORD` does not reinitialize a persistent database. Rotate customer Redis credentials with the customer and recheck `/ready` and scrape health.

When offboarding, disable access, agree on export/retention, take the final audit backup, revoke Redis credentials and remove DNS. Stop the resource first. Delete volumes and retained secrets only when the retention agreement authorizes deletion. PostgreSQL and Prometheus contain customer operational data; no operation should delete the customer's Redis tasks.
