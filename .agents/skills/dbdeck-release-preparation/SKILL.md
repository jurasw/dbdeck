---
name: dbdeck-release-preparation
description: Prepare DBDeck Marketplace metadata, documentation and validated VSIX artifacts without publishing.
---

# Dbdeck Release Preparation

Read assets/marketplace/publishing.md, assets/marketplace/listing.md, apps/extension/package.json, apps/extension/.vscodeignore and packaging workflows. Run npm run validate, npm run package:check and npm run package in apps/extension. Inspect the VSIX for bundles, media, syntaxes, README, changelog and license, excluding secrets and tooling. Keep version and changelog aligned. A local package does not verify publisher ownership. Preparation does not authorize Marketplace/Open VSX publishing, publisher registration, GitHub Releases or credential setup. Publication requires a separate explicit request.
