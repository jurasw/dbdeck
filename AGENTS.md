# Agent rules

DBDeck is a monorepo with two independent npm packages, each with its own lockfile:

- `apps/extension/` — the VS Code / Cursor extension. Read `.agents/extension.md` for `src/` changes and `.agents/webview.md` for `webview/` changes.
- `apps/web/` — the dbdeck.dev landing page (Next.js static export, shadcn/ui, Cloudflare). Read `.agents/web.md`.
- `assets/` — brand, screenshots and store listing materials. Not shipped by either app; copy what an app needs into it.

Task recipes live in `.agents/skills/`. Run npm commands inside the package you change. `mprocs.yaml` starts the dev processes with `phrocs` (or `mprocs`).

Trace the affected flow and callers before editing. Reuse existing helpers and platform APIs; keep changes focused. Preserve pre-existing work in the tree.

## Naming and checks

- Product: **DBDeck**. Extension package, command and configuration namespace: `dbdeck`.
- New files use kebab-case; classes and types use PascalCase; functions use camelCase. Preserve existing imports and public command IDs when updating older files.
- Extension behavioral tests live in `apps/extension/test/<area>.spec.ts`. Execute the interface and assert observable results rather than searching source text.
- Extension: `npm run check`, `npm run lint`, `npm test` and `npm run build`; `npm run validate` runs all four.
- Web: `npm run lint` and `npm run build` in `apps/web`.
- Lock dependency changes with each package's `package-lock.json`. Use Node 22 (`.nvmrc`) and `npm ci` in CI.
- Workflow names follow `<area>-<task>-on-pr.yml` and `<area>-package.yml`.

## Release boundary

Build and inspect VSIX artifacts locally. Publishing to Marketplace, Open VSX or GitHub Releases and deploying the website need an explicit request. Do not register a publisher or store publishing credentials in the repository.

## Local extension updates

After changing the extension, apply `.agents/skills/dbdeck-local-update/SKILL.md` to validate, package and update the locally installed extension.
