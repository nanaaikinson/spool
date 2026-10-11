# Contributing to Spool

Thanks for helping. Bug reports, fixes and focused improvements are all welcome. For larger changes, open an issue first so we can agree on the approach.

## Set up

You need Go 1.27+, Node 24+, pnpm 10.33 (`corepack enable` picks the version pinned in `apps/web/package.json`) and Docker Compose. Installer checks also require Python 3, Bash and OpenSSL.

```sh
cp .env.example .env
make install
make infra      # Redis and Prometheus on local ports
make run-dev    # API server and web UI together
REDIS_URL=redis://127.0.0.1:6388/0 make demo   # optional sample traffic
```

Run `make` to list every target.

For installation work, use `./scripts/install.sh --configure-only --env-file /path/to/private/config.env` to try the prompts and inspect the generated configuration without starting services. The parent directory must exist. The default self-hosted entry point is `make self-host`; `make install` installs frontend dependencies for development. See the [deployment guide](docs/deployment.md) for the installation flow and persistent data.

## Before opening a pull request

```sh
make lint test api-check
make test-install  # real Compose parsing; does not need the Docker daemon or network services
make e2e        # browser tests; needs `cd apps/web && pnpm exec playwright install chromium` once
```

- **API changes:** edit the endpoint registry in `internal/api/contract.go` and the DTOs in `internal/domain`, then run `make api-client` and commit the regenerated `api/openapi.json` and `apps/web/src/api/generated`.
- **Database changes:** add idempotent SQL under `db/migrations` and embed it in `db/migrations/embed.go`. Migrations run at startup.
- **UI changes:** follow [docs/design.md](docs/design.md), including its copy guidelines. Check phone, tablet and desktop widths.
- **Tests:** add or update tests with behaviour changes. Integration tests need only an isolated Redis through `SPOOL_TEST_REDIS`. Store tests use a temporary SQLite file and always run. `SPOOL_TEST_DATABASE` is optional and only overrides the SQLite file path for Playwright; see the README.
- **Installation changes:** keep `scripts/install.sh`, the production Compose files, environment templates and deployment guide consistent. Run `make test-install` for bundled/external Prometheus, literal credential handling, file permissions, reruns and failure handling. ShellCheck is useful for changes to the Bash installer. Test live startup against an isolated Redis, never a production Asynq database.

CI runs installer checks alongside API generation, lint, unit tests, builds and browser tests. The installer suite parses real Compose configurations and mocks daemon operations; live container readiness and metrics scraping need a separate smoke test when deployment behavior changes.

Keep pull requests focused, and explain the problem and how you verified the fix. Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org/) style (`fix:`, `feat:`, `docs:`).

## Releases

Every push to `main` that passes the checks is released automatically. The commit types since the last release decide the version:

- `feat:` releases a new minor version.
- `fix:` or `perf:` releases a patch version.
- `feat!:` (any type with `!`) or a `BREAKING CHANGE:` footer releases a new major version, or a minor version while Spool is below 1.0.
- `docs:`, `chore:`, `ci:`, `test:`, `refactor:`, `style:` and `build:` don't release on their own.

Run `scripts/next-version.sh` to see what the next release would be. The release workflow tags the commit, publishes the container image to GHCR and writes release notes from the commit subjects, so make the subject readable on its own. To publish a prerelease, push a tag such as `v0.3.0-rc.1` by hand.

## Reporting security issues

Don't open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
