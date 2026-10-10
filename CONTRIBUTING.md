# Contributing to Spool

Thanks for helping. Bug reports, fixes and focused improvements are all welcome. For larger changes, open an issue first so we can agree on the approach.

## Set up

You need Go 1.27+, Node 24+, pnpm (via `corepack enable`) and Docker Compose.

```sh
cp .env.example .env
pnpm --dir apps/web install --frozen-lockfile
make infra      # Redis, PostgreSQL and Prometheus on local ports
make run-dev    # API server and web UI together
REDIS_URL=redis://127.0.0.1:6388/0 make demo   # optional sample traffic
```

Run `make` to list every target.

## Before opening a pull request

```sh
make lint test api-check
make e2e        # browser tests; needs `pnpm --dir apps/web exec playwright install chromium` once
```

- **API changes:** edit the endpoint registry in `internal/api/contract.go` and the DTOs in `internal/domain`, then run `make api-client` and commit the regenerated `api/openapi.json` and `apps/web/src/api/generated`.
- **Database changes:** add idempotent SQL under `db/migrations` and embed it in `db/migrations/embed.go`. Migrations run at startup.
- **UI changes:** follow [docs/design.md](docs/design.md), including its copy guidelines. Check phone, tablet and desktop widths.
- **Tests:** add or update tests with behaviour changes. Integration tests use isolated services through `SPOOL_TEST_REDIS` and `SPOOL_TEST_DATABASE`; see the README.

Keep pull requests focused, and explain the problem and how you verified the fix. Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org/) style (`fix:`, `feat:`, `docs:`).

## Reporting security issues

Don't open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
