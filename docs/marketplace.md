# Marketplace preparation

Status: unpublished preview. Workflows build VSIX artifacts only, without publishing to Marketplace, Open VSX or GitHub Releases.

## Prepared

- Manifest description, keywords, categories, preview flag, gallery banner and repository links.
- README, MIT license and unreleased changelog included in the package.
- Production build through the `vscode:prepublish` hook.
- `.vscodeignore` allowlist for runtime assets and listing documentation.
- Validation on PRs and main; manual packaging with downloadable artifacts.

## Before publication

1. Confirm ownership and availability of publisher ID `dbdeck`. This is the existing manifest value, not a verified or registered publisher.
2. Add a final PNG listing icon (at least 128 × 128) and set the manifest `icon` field. Existing SVG icons are runtime assets.
3. Capture screenshots or a demo in the real extension using disposable data. Review listing claims and exclude credentials.
4. Run `npm ci`, `npm run validate`, `npm run package:check` and `npm run package`. Inspect the VSIX and install in VS Code and Cursor. Smoke-test supported services, SSH, read-only mode, staged writes and exports. Automated specs currently cover SQL splitting and value conversion, not full driver integration.
5. Review dependency advisories and bundled runtime requirements.
6. Set the release version and changelog date once the preview is accepted.
7. Configure publishing authentication and distribution only after a separate publication request. Use a protected publishing workflow at that time.

Packaging needs no publishing token. Do not store publishing credentials in this repository.

Follow the [official VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for current publisher and authentication requirements.
