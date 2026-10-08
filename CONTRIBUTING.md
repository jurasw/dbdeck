# Contributing to DBDeck

Use Node.js 22 (`nvm use`). The repository holds independent packages: the extension in `apps/extension`, the desktop demo in `apps/desktop`, the website in `apps/web` and the promo video in `apps/video`. Install each with `npm ci` inside its folder.

Start everything from the repository root with `phrocs` or [mprocs](https://github.com/pvolok/mprocs) (`brew install mprocs`):

```bash
phrocs
```

Or work in one package: run `npm run watch` in `apps/extension` and press F5 in VS Code for an Extension Development Host.

## Changes

Create a focused branch and describe the problem, resulting behavior and verification in your PR. Product naming is DBDeck; package, commands and configuration use `dbdeck`. New files use kebab-case and extension tests use `apps/extension/test/<area>.spec.ts`. Preserve existing public IDs.

Read [AGENTS.md](AGENTS.md) and relevant area rules under `.agents/`. Task recipes live in `.agents/skills/`.

## Checks

```bash
cd apps/extension
npm run format
npm run validate
npm run package

cd ../web
npm run lint
npm run build
```

Extension tests use Node's runner and esbuild. Assert observable behavior rather than source spelling. Docker Compose services in `apps/extension/test/docker-compose.yml` are for manual integration checks and are not started by `npm test`.

After shared extension changes, run `npm run validate` in `apps/desktop` too. Desktop builds import extension source and rebuild its webviews. On macOS, `npm run test:smoke` verifies the actual shared UI and `npm run package` builds both demo DMGs. See [Desktop demo](apps/desktop/README.md). Desktop checks are triggered by extension changes as well as desktop changes. The desktop version follows the extension with a demo suffix; packaging does not publish it.

Oracle integration checks use the optional `oracle` Compose profile:

```bash
cd apps/extension
docker compose -f test/docker-compose.yml --profile oracle up -d --wait oracle
DBDECK_ORACLE_INTEGRATION=1 npm test
docker compose -f test/docker-compose.yml --profile oracle stop oracle
```

D1 specs exercise the REST wire format against a disposable SQLite database served locally; no Cloudflare credentials are needed.

Document visible changes and update `apps/extension/CHANGELOG.md`. Do not include credentials, database dumps or customer data in reports or fixtures.

## Release preparation

See [Publishing](assets/marketplace/publishing.md). Pull requests run `extension-check-on-pr` and `web-check-on-pr`, and the extension check uploads the VSIX for review. A push to `main` that touches `apps/web` deploys dbdeck.dev (`web-prod-deploy`). Bumping the version in `apps/extension/package.json` on `main` publishes the extension (`extension-publish`): Marketplace and Open VSX when their tokens are set, plus a GitHub release.

DynamoDB, MSSQL and Cassandra integration checks use optional Compose profiles:

```bash
cd apps/extension
docker compose -f test/docker-compose.yml --profile dynamodb --profile mssql --profile cassandra up -d dynamodb mssql cassandra
DBDECK_DYNAMODB_INTEGRATION=1 DBDECK_MSSQL_INTEGRATION=1 DBDECK_CASSANDRA_INTEGRATION=1 npm test
```

SQL Server's Linux image requires an x86-64 Docker environment or working emulation. These tests use only disposable local databases.
