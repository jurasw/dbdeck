---
name: dbdeck-release-preparation
description: Prepare DBDeck Marketplace metadata, documentation and validated VSIX artifacts without publishing.
---

# Dbdeck Release Preparation

Read assets/marketplace/publishing.md, assets/marketplace/listing.md, apps/extension/package.json, apps/extension/.vscodeignore and packaging workflows. Run npm run validate, npm run package:check and npm run package in apps/extension. Inspect the VSIX for bundles, media, syntaxes, README, changelog and license, excluding secrets and tooling. Keep version and changelog aligned. A local package does not verify publisher ownership. Preparation does not authorize Marketplace/Open VSX publishing, publisher registration, GitHub Releases or credential setup. Publication requires a separate explicit request.

For desktop demo preparation, apply `../dbdeck-desktop-sync/SKILL.md`, then run `npm run package` in `apps/desktop` on macOS and inspect both architecture DMGs. The desktop version follows the extension with a demo suffix; do not bump the extension just to package a demo. Verify the packaged app's Demo label and signing/notarization status. Public desktop assets use a separate GitHub prerelease, with landing links enabled through `apps/web/content/desktop-demo.json` only after both files exist. Preparation does not publish or deploy the landing.
