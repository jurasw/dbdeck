<p align="center"><img src="assets/icon.png" alt="DBDeck" width="88" height="88"></p>

# DBDeck desktop demo

A standalone macOS demo of DBDeck for Apple Silicon and Intel MacBooks, distributed as a DMG. The title bar and start screen identify it as **Demo**.

The desktop app imports the extension's connection store, manager, tree, drivers, query execution and panels directly from `apps/extension/src`. It packages the extension's built webviews and media. The grid, connection form, schema diagrams, query results and Redis key editor have one implementation. `src/vscode-host.ts` provides the small editor API adapter needed by those panels; `src/desktop.ts` provides the desktop navigation and query input.

Demo shop is a bundled sample SQLite database with a read-only connection. You can add your own connections using the extension's form. The demo includes database browsing, SQL / MongoDB / Elasticsearch queries, transactional grid edits where the extension supports them, exports, schema diagrams and Redis key editing. AI, MCP, editor completions, storage file actions and Docker controls remain extension features in this first demo.

Connection settings are stored separately from the editor in the application's user data directory. Remembered secrets are encrypted with Electron safeStorage backed by macOS Keychain. Turning off Remember password keeps secrets in memory only. Database queries run in the main process. Renderers are sandboxed, have context isolation and cannot access Node or the filesystem.

## Develop and package

The default icon is white glass Data Core on black. Edit `../../assets/brand/icon-art.mjs` and run `node assets/brand/export-icons.mjs` from the repository root before rebuilding. The application and DMG use the exported ICNS; the start screen uses the matching PNG.

Use Node 22 and install both packages with `npm ci`. From `apps/desktop`:

```bash
npm run dev
npm run validate
npm run test:smoke
npm run package
```

`build` always rebuilds the extension webviews first. `sync-version.mjs` follows the extension version with a `-demo.N` suffix and updates the desktop lockfile, without changing the extension version. `package` builds both architectures without publishing. `package:arm64` builds only Apple Silicon.

Artifacts: `out/DBDeck-demo-arm64.dmg` and `out/DBDeck-demo-x64.dmg`. Drag **DBDeck Demo.app** into Applications. These initial local artifacts use an ad hoc signature, without Developer ID signing or notarization. macOS may require approval in System Settings > Privacy & Security before opening; a public release should clearly state its signing status.

`test:smoke` launches Electron with disposable application data and checks the actual shared form, grid, schema and query results. It writes screenshots to `out/screenshots`. Run it on macOS with a graphical session. `desktop-check-on-pr.yml` checks shared extension changes too; `desktop-package.yml` creates DMGs for manual review.

## Downloads

Desktop downloads use a separate GitHub prerelease, so they never replace the extension's latest stable release. Upload both DMGs under the names above. After the assets are public, set `releaseTag` in `apps/web/content/desktop-demo.json` to that release tag; the landing page then exposes direct downloads for both architectures. Before publication it shows the demo description and a preparation status, without broken download links. DMGs are not copied into the Cloudflare static export.

Publishing a GitHub release or deploying dbdeck.dev requires an explicit request under the repository's release boundary. Building the DMGs does not publish them.
