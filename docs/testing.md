# Local organization and RBAC testing

Use a separate local stack with its own PostgreSQL and Prometheus volumes, two private Redis services and optional Asynq demo workers. Go serves the built React UI, so local Node and Go installations are unnecessary. Docker Compose supporting `up --wait` is required. The default development `compose.yaml` runs legacy accounts; use this dedicated configuration for organization management.

## Start

From the repository root:

```sh
cp .env.rbac.example .env.rbac
docker compose --env-file .env.rbac --profile demo up -d --build --wait
```

Open **http://localhost:8098** and sign in as **admin / local-admin-password**. The initial organization is **Alpha**, connected to `redis://redis-alpha:6379/0`. The demo workers create synthetic tasks only in this stack's Redis services. Only the console has a published port, bound to loopback. Existing development/self-hosted databases and Redis are not used.

Reuse `.env.rbac` on subsequent runs; the `spool-rbac` project retains its accounts, organizations, keys and volumes. Change `SPOOL_HOST_PORT` if 8098 is occupied. The example secrets are public and intended only for this local test stack.

## Organizations and accounts

1. In **Settings → Create organization**, create **Beta** with Redis URL `redis://redis-beta:6379/0`. Leave Prometheus blank to use the bundled service.
2. Switch between Alpha and Beta using the sidebar selector. Each has separate task IDs, workers, audit, saved views and chart data, even though queue names can be identical. Check connection status in Settings and allow the first Prometheus samples to arrive.
3. In **Alpha → Settings → Organization members**, create these local accounts:

   | Username | Role | Example local password |
   | --- | --- | --- |
   | `alpha-admin` | admin | `alpha-admin-password` |
   | `alpha-operator` | operator | `alpha-operator-password` |
   | `alpha-viewer` | viewer | `alpha-viewer-password` |

4. In Beta, add the existing `alpha-operator` as **viewer**, leaving its password blank. Its Alpha role remains operator. The other accounts should have no Beta membership.

## Permission checks

Use separate browser profiles for different accounts, or sign out between checks; tabs in the same profile share a sign-in cookie. Two tabs using the same account can select different organizations independently.

| Account | Expected behavior |
| --- | --- |
| Deployment `admin` | Access both organizations, create organizations, replace connections, manage global accounts and deployment administration. |
| `alpha-admin` | Manage Alpha members and rename Alpha. No Beta access, organization creation, connection replacement or deployment account management. |
| `alpha-operator` in Alpha | Pause/resume queues, retry/archive tasks and save views. No member or deployment account management. |
| `alpha-operator` in Beta | Inspect data; no task/queue actions or saved-view mutations. Alpha's views and audit entries are absent. |
| `alpha-viewer` | Inspect Alpha data and audit; no task/queue actions, saved-view mutations, member management or Beta access. |

While the operator is signed in, change its Alpha role to viewer from the administrator profile. Its next requests must use the new permission. Remove its Beta membership and confirm Beta data is inaccessible. Disable it through Deployment accounts and confirm existing sessions stop working; enabling restores sign-in, and resetting its password revokes sessions again. Removing or disabling the last active organization/deployment administrator must be rejected.

To test handover, create a successor account and use **Transfer administration** with the acting administrator's current password. Both accounts sign in again; the successor gains deployment authority and the former administrator keeps only existing memberships. Keep the successor credentials. For [administrator recovery](organizations.md#recover-a-deployment-administrator), use the local app container with `--env-file .env.rbac`.

## First setup through UI or CLI

On a **fresh** stack, leave `SPOOL_ADMIN_USER` and `SPOOL_ADMIN_PASSWORD` empty in `.env.rbac` before starting. The UI asks for the setup token from that file, organization name and new administrator credentials. Leave Redis blank to use `redis-alpha`. Editing bootstrap variables after accounts exist does not reset them or return to first setup.

For the [setup CLI](organizations.md#cli-setup), prepare its private JSON and run:

```sh
docker compose --env-file .env.rbac exec -T app \
  /app/spool setup --url http://127.0.0.1:8080 < private-setup.json
```

## Stop or reset

Stop while keeping data:

```sh
docker compose --env-file .env.rbac --profile demo down
```

To deliberately erase **this test stack's** accounts, organizations, tasks and metrics for fresh onboarding:

```sh
docker compose --env-file .env.rbac --profile demo down --volumes
```

Keep these commands pointed at `.env.rbac` and the `spool-rbac` project. Removing volumes is unnecessary for routine restarts.
