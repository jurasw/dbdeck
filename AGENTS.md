# Agent rules

Read `.agents/extension.md` for `src/` changes and `.agents/webview.md` for `webview/` changes. Task recipes live in `.agents/skills/`.

Trace the affected flow and callers before editing. Reuse existing helpers and platform APIs; keep changes focused. Preserve pre-existing work in the tree.

## Naming and checks

- Product: **DBDeck**. Package, command and configuration namespace: `dbdeck`.
- New files use kebab-case; classes and types use PascalCase; functions use camelCase. Preserve existing imports and public command IDs when updating older files.
- Behavioral tests live in `test/<area>.spec.ts`. Execute the interface and assert observable results rather than searching source text.
- Use `npm run check`, `npm run lint`, `npm test` and `npm run build`; `npm run validate` runs all four.
- Lock dependency changes with `package-lock.json`. Use Node 22 (`.nvmrc`) and `npm ci` in CI.
- Workflow names follow `<area>-<task>-on-pr.yml` and `<area>-package.yml`.

## Release boundary

The current scope is release preparation. Build and inspect VSIX artifacts locally; do not publish to Marketplace, Open VSX or GitHub Releases without explicit authorization. Do not register a publisher or store publishing credentials as part of preparation.

## Local extension updates

After changing DBDeck, apply `.agents/skills/dbdeck-local-update/SKILL.md` to validate, package and update the locally installed VS Code extension.
