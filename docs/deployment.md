# Production deployment

Spool's Dockerfile builds the React frontend and Go server into one non-root application image. The Go server serves both the UI and API on **8080**. You do not need a separate Node server or frontend deployment.

Choose the dependencies you want Spool to manage:

| Deployment | Compose file | Environment template |
| --- | --- | --- |
| Your Asynq Redis + a bundled PostgreSQL 17 database | `compose.production.redis.yaml` | `.env.production.redis.example` |
| Your Asynq Redis + your PostgreSQL database | `compose.production.external.yaml` | `.env.production.external.example` |

Both require real credentials, restart services after host restarts, and use the image's `/ready` health check. Neither starts Redis, Asynq workers, demo traffic, or Prometheus. PostgreSQL in the first option has a persistent named volume and no published host port. The app has no local application data that needs a volume.

## Connection values

Use the same Redis host, port, **database index**, and credentials as your existing Asynq application. Spool currently uses Asynq v0.26.0; verify compatibility if your workers use a different release or a custom fork. Spool connects through Inspector; it does not replace your workers or require their source code.

Example connection formats, with placeholders to replace:

```dotenv
# Password-only Redis
REDIS_URL=redis://:URL_ENCODED_PASSWORD@redis.example.com:6379/0
# Named Redis ACL user, with TLS
REDIS_URL=rediss://spool:URL_ENCODED_PASSWORD@redis.example.com:6380/0
# External PostgreSQL with certificate and hostname verification
DATABASE_URL=postgres://spool:URL_ENCODED_PASSWORD@postgres.example.com:5432/spool?sslmode=verify-full
```

Percent-encode special characters in URI usernames/passwords, including `@`, `:`, `/`, `#`, and `%`. Use your provider's endpoint and TLS settings. Publicly trusted TLS certificates work with the image's CA bundle; a private PostgreSQL CA requires a read-only certificate mount and `sslrootcert=/path/in/container/ca.pem` in `DATABASE_URL`. Redis private CA/client-certificate configuration is not exposed by the current environment configuration.

External PostgreSQL must already contain the database named in `DATABASE_URL`. Give the application role permission to create its tables/indexes and read/write them. Spool runs its own migrations on startup; no separate migration command is needed. PostgreSQL holds audits and saved views, while tasks remain in your Asynq Redis.

Generate a different random value for each secret:

```sh
openssl rand -hex 32
```

Use the output for `SPOOL_ADMIN_PASSWORD`, repeat for `SPOOL_SESSION_KEY`, and repeat for `POSTGRES_PASSWORD` when using bundled PostgreSQL. The signing key must be at least 32 characters. For bundled PostgreSQL, use a hexadecimal/alphanumeric password because Compose interpolates it directly into the connection URI. Keep the signing key stable between deployments to preserve sessions.

Containers have their own loopback interface. A URL containing `localhost` or `127.0.0.1` connects to the Spool container itself. Use a reachable private DNS name or the database service name on a shared Docker network. Allow connections from the deployment server in your database firewall.

## Dokploy

1. Put the project in your Git repository. Create a **Docker Compose** resource and connect that repository and branch.
2. Select Compose mode and the chosen root-level production file. Stack mode cannot build this source-based configuration.
3. In **Environment**, enter the values from the matching template. These files explicitly pass environment variables to containers.
4. In **Domains**, target service `app`, path `/`, container port **8080**, and enable HTTPS with your certificate provider. Point your domain's DNS at the server.
5. Preview the generated Compose definition. Keep `app` and `postgres` on their shared `default` network; Dokploy also connects `app` to its proxy network. Deploy after domain changes.

Dokploy adds the proxy labels. Leave PostgreSQL without a domain or published port. See the official [Compose guide](https://docs.dokploy.com/docs/core/docker-compose) and [Compose domains guide](https://docs.dokploy.com/docs/core/docker-compose/domains).

## Coolify

1. Create a resource from the project's **Git repository** and select the **Docker Compose** build pack.
2. Set Base Directory to `/` and Docker Compose Location to `/compose.production.redis.yaml` or `/compose.production.external.yaml`.
3. Save/load the definition, then fill **Environment Variables** from the matching template. Required values must be populated before deploying.
4. Set service `app`'s domain to `https://spool.example.com:8080`. The suffix selects the internal container port; visitors use ordinary HTTPS on 443.
5. Keep **Raw Compose Deployment** disabled and deploy. Image-defined health checks apply to Compose deployments.

If connecting to another Coolify database resource, enable **Connect To Predefined Network** and use its actual internal hostname. The bundled PostgreSQL already shares this resource's network. See the official [Compose guide](https://coolify.io/docs/applications/builds/docker-compose).

## Dockerfile deployment on either platform

Use this when PostgreSQL and Redis are provisioned separately, including database resources managed by the hosting platform.

| Setting | Dokploy | Coolify |
| --- | --- | --- |
| Resource | Application linked to your Git repository | Application linked to your Git repository |
| Build type/pack | Dockerfile | Dockerfile |
| Build context/base directory | Repository root | `/` |
| Dockerfile | Root `Dockerfile` | `/Dockerfile` |
| Container port | Domain target port `8080` | Ports Exposes `8080` |
| Runtime environment | Values from `.env.production.external.example` | Values from `.env.production.external.example` |
| Domain | HTTPS domain for this application | HTTPS domain for this application |

The image already listens on `0.0.0.0:8080` and checks `/ready`. Supply secrets at runtime. The platform builds the frontend automatically; no custom start command is needed.

The Dockerfile requires the **whole repository as build context** because it copies the Go and frontend source. Pasting only its text into a deployment without source files cannot build this app. For deployment without a Git checkout, build and push an image to your registry, then use the platform's Docker Image resource.

See [Dokploy's Dockerfile build settings](https://docs.dokploy.com/docs/core/applications/build-type) and [Coolify's Dockerfile guide](https://coolify.io/docs/applications/builds/dockerfile).

## Compose on your own Docker host

For your Redis with bundled PostgreSQL:

```sh
cp .env.production.redis.example .env.production
chmod 600 .env.production
# Edit .env.production and supply REDIS_URL and the three generated secrets.
docker compose --env-file .env.production -p spool-production \
  -f compose.production.redis.yaml -f compose.production.host.yaml config --quiet
docker compose --env-file .env.production -p spool-production \
  -f compose.production.redis.yaml -f compose.production.host.yaml up -d --build --wait
```

For your own Redis and PostgreSQL, copy `.env.production.external.example` instead, supply `DATABASE_URL`, and replace `compose.production.redis.yaml` with `compose.production.external.yaml` in both commands.

The optional `compose.production.host.yaml` override publishes **127.0.0.1:8080** for a reverse proxy installed on the host. Set `SPOOL_HOST_PORT` if that port is occupied. Omit this override on Dokploy/Coolify, or when a containerized proxy connects directly to `app:8080` on the Compose network.

## Dockerfile on your own Docker host

This runs only Spool. Provide your own PostgreSQL and Redis:

```sh
cp .env.production.external.example .env.production
chmod 600 .env.production
# Edit .env.production: fill both connection URLs, admin password and signing key.
docker build -t spool:production .
docker run -d --name spool --restart unless-stopped \
  --stop-timeout 30 --env-file .env.production \
  -p 127.0.0.1:8080:8080 spool:production
docker inspect --format '{{.State.Health.Status}}' spool
docker logs spool
```

Use unquoted literal values in an env file shared with `docker run`; its parser does not remove quotes or expand variables like Compose's dotenv parser. The generated hexadecimal secrets avoid interpolation differences. Never put production secrets into Dockerfile `ENV`, build arguments, or the Git repository. Production env files are ignored by Git and excluded from the Docker build context.

## HTTPS and proxy routing

Keep `SPOOL_SECURE_COOKIE=true` and access the UI through HTTPS. Direct HTTP readiness checks work, but an HTTPS-only session cookie cannot support an ordinary remote HTTP login.

Preserve the original HTTP `Host` header so same-origin checks work. Allow streaming responses for `/api/v1/events`; do not enable proxy buffering for SSE. Serve Spool at the domain root.

`/metrics` is an unauthenticated scrape endpoint. Keep it on a private monitoring path/network, or deny that exact path at public ingress. For a Traefik public router, the route rule can be ``Host(`spool.example.com`) && !Path(`/metrics`)``: apply it to the generated public router using your platform's proxy-label configuration. Keep `/api/v1/metrics` accessible; it is a separate authenticated API endpoint.

For example, with **Caddy installed directly on the Docker host**, this Caddyfile routes the UI/API, denies public metrics, and uses automatic HTTPS. Point the domain's DNS at the host and allow Caddy to receive traffic on ports 80 and 443:

```caddyfile
spool.example.com {
    @metrics path /metrics
    handle @metrics {
        respond 404
    }
    handle {
        reverse_proxy 127.0.0.1:8080
    }
}
```

Caddy preserves Host for this HTTP upstream and streams SSE responses. See its [reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and [automatic HTTPS documentation](https://caddyserver.com/docs/automatic-https).

## Metrics, persistence and updates

Set `PROMETHEUS_URL` only if you have Prometheus. Its scrape target should reach this app's internal `:8080/metrics`; for a shared Docker network, use `app:8080`. Without Prometheus, live queue/task inspection works, but historical charts have no source.

Back up the bundled PostgreSQL database and keep its named volume. Keep the same Compose project name/resource across redeployments. Do not use `docker compose down -v` unless you intend to delete audit logs and saved views. Changing `POSTGRES_PASSWORD` in the environment does not change a password in an already initialized PostgreSQL volume: rotate the database role's password and update the app together. Keep PostgreSQL on major version 17 until you perform a planned database upgrade.

After updates, rebuild/redeploy and verify `/ready` and the HTTPS login. `/health` only confirms the process is running; `/ready` checks Redis and PostgreSQL connectivity. If startup fails, inspect logs for database reachability, credentials, migration permissions, or an invalid session key.
