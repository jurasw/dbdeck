---
name: dbdeck-release-status
description: Check whether the current DBDeck extension version is published on the VS Marketplace, Open VSX and GitHub Releases, and whether the checkout has unreleased extension changes. Use when the user asks if the version is in the Marketplace, what is released, or whether a release is needed.
---

# DBDeck release status

Run `npm run release:status` in `apps/extension`. Use `npm run -s release:status -- --json` for machine-readable output. The script is read-only: it fetches tags from origin, queries the stores and reads local git state and editor installs.

It reports:

- the `package.json` version and the version on `origin/main`;
- the latest version on the VS Marketplace, Open VSX and GitHub Releases (`✓` matches the local version, `✗` differs or is missing, `?` could not be checked);
- the DBDeck version installed in Cursor and VS Code;
- commits in `apps/extension` since the `extension-v<version>` tag, unpushed commits, uncommitted files and `## Unreleased` CHANGELOG entries;
- the last `extension-publish.yml` run.

Answer with the verdict line first, then only the rows that need action. Rules for the verdict:

- A store without the local version means the version is not published there. On `main`, `extension-publish.yml` publishes a new version when `apps/extension/package.json` changes; a missing Open VSX version usually means `OVSX_PAT` is not set.
- The same version published plus commits, uncommitted files or Unreleased entries means the store build is older than the checkout. Releasing needs a version bump, which follows `dbdeck-feature-docs` and needs an explicit request.
- A Marketplace note other than `validated` means the version is still being verified.
- Installed versions can come from a local VSIX, so a matching number does not prove the store build is installed.

Do not bump, tag, publish or re-run workflows from this skill.
