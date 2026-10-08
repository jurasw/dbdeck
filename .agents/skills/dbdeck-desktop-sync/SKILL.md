---
name: dbdeck-desktop-sync
description: Keep the DBDeck macOS desktop demo in sync with shared extension drivers, panels and webviews, and build validated DMG artifacts.
---

# Desktop sync

Apply after extension driver, panel, connection, query or webview changes, and when changing the desktop host. Read `.agents/desktop.md`. Desktop imports extension sources directly and copies built webviews during `npm run build`; never copy a driver, panel handler or grid implementation into desktop source.

From `apps/desktop`, run `npm run validate` with Node 22. Run `npm run test:smoke` on macOS when panels, RPC or the host changed; it verifies the shared UI with disposable application data. Update `src/vscode-host.ts` if a shared panel requires another supported platform API. Features requiring the editor remain explicitly listed as unavailable in the demo until implemented.

For the user's local update, run `npm run package:arm64` on Apple Silicon (or package both with `npm run package` when asked for downloadable artifacts). The build always rebuilds extension webviews. `scripts/sync-version.mjs` derives the demo version from the extension package; do not bump the extension to refresh a local DMG. Inspect the generated app and report the DMG path and signing status. Do not replace a running installed app automatically.

Keep the desktop README, root README, extension CHANGELOG and landing demo section consistent. Public assets belong to a separate GitHub prerelease named by `apps/web/content/desktop-demo.json`; enable `releaseTag` only after both DMGs exist in that release. Publication and landing deployment require the explicit request described in `AGENTS.md`. Building artifacts and updating shared source do not grant publication permission.
