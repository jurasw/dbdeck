# Contributing to DBDeck

Use Node.js 22 (`nvm use`). The repository holds two packages: the extension in `apps/extension` and the website in `apps/web`. Install each with `npm ci` inside its folder.

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

Document visible changes and update `apps/extension/CHANGELOG.md`. Do not include credentials, database dumps or customer data in reports or fixtures.

## Release preparation

See [Publishing](assets/marketplace/publishing.md). CI uploads VSIX artifacts for review. Publication is a separate maintainer action.
