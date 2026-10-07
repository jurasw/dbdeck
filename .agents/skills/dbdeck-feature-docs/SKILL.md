---
name: dbdeck-feature-docs
description: Sync README files, the dbdeck.dev landing page, CHANGELOG, version, store listing and assets after a user-visible DBDeck feature or fix.
---

# Dbdeck Feature Docs

Apply after a change that a user can see: a new feature, service, command, setting, visible fix or changed behavior. Skip for refactors, tests and tooling. Read `git diff main...HEAD` and the touched commands in `apps/extension/package.json` to list what changed, then update every surface that describes it. Keep one wording per feature across surfaces and match the tone and length of nearby entries.

Never use the em dash character (U+2014) or double hyphens as punctuation in DBDeck copy. Rewrite the sentence or use a comma, colon or parentheses. Preserve hyphens required by commands, SQL and other syntax.

## Surfaces

| File | Update when |
| --- | --- |
| `apps/extension/CHANGELOG.md` | Always. Add a line under `## Unreleased` at the top (create it if missing). Fixes start with `Fixed`. |
| `apps/extension/README.md` | Marketplace page. Service table, `## Features` list, dedicated sections (Schema diagram, AI queries) for big features. |
| `README.md` | GitHub page. `## What it does`, feature tables, screenshots, Install, How it fits together, Developing locally. |
| `apps/web/app/page.tsx` | Landing page. `services` list, feature sections and their `SmallList` items, counts such as "Eight services" and "8 types". |
| `apps/web/components/site/faq.tsx` | Feature changes privacy, data sent off the machine, pricing or supported editors. |
| `apps/web/app/layout.tsx` | Service list or tagline changes the meta description. |
| `apps/extension/package.json` | New service or major feature changes `description` or `keywords`. |
| `assets/marketplace/listing.md` | Short description, tags, screenshots or announcement text no longer match. |
| `assets/brand/og/og.html` | Social preview names something that changed. Re-render with `assets/README.md`. |
| `assets/screenshots/`, `assets/readme/` | Visible UI the images show changed. Capture as `assets/README.md` describes and copy to `apps/web/public/screenshots/`. Report a stale image instead of faking one. |
| `.agents/*.md`, `CONTRIBUTING.md`, `AGENTS.md` | New area, script, workflow or dev process. |

A new service touches all README tables, `services` and the counts in `page.tsx`, `layout.tsx`, `package.json` `description` and `keywords`, `listing.md`, the service SVGs in `assets/readme/` and the icon in `apps/web/public/types/`.

## Version

The extension uses semver while in `0.x`: a feature or breaking change bumps minor, a fix only bumps patch. Do not bump during feature work. A version change in `apps/extension/package.json` on `main` publishes to Marketplace, Open VSX and GitHub Releases, so bump only on an explicit release request:

```bash
cd apps/extension
npm version <minor|patch> --no-git-tag-version
```

Then rename `## Unreleased` to `## <version> (<YYYY-MM-DD>)`. `extension-publish.yml` takes the release notes from the CHANGELOG heading that contains the version. `apps/web` has no product version; any change under `apps/web` merged to `main` deploys dbdeck.dev.

## Checks

Run `npm run validate` in `apps/extension` and `npm run lint` and `npm run build` in `apps/web` when the page changed. Check that README image paths exist and the root and extension READMEs list the same services. Report which surfaces were updated, which were skipped as unaffected and which images are stale.
