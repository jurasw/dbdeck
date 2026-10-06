# Contributing to DBDeck

Use Node.js 22 (`nvm use`) and `npm ci`. Run `npm run watch` and press F5 in VS Code for an Extension Development Host.

## Changes

Create a focused branch and describe the problem, resulting behavior and verification in your PR. Product naming is DBDeck; package, commands and configuration use `dbdeck`. New files use kebab-case and tests use `test/<area>.spec.ts`. Preserve existing public IDs.

Read [AGENTS.md](AGENTS.md) and relevant area rules under `.agents/`. Task recipes live in `.agents/skills/`.

## Checks

```bash
npm run format
npm run validate
npm run package
```

Tests use Node's runner and esbuild. Assert observable behavior rather than source spelling. Docker Compose services are for manual integration checks and are not started by `npm test`.

Document visible changes and update `CHANGELOG.md`. Do not include credentials, database dumps or customer data in reports or fixtures.

## Release preparation

See [Marketplace preparation](docs/marketplace.md). CI uploads VSIX artifacts for review. Publication is a separate maintainer action.
