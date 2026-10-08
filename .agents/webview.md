# Webviews

Desktop demo packages these same webviews. Shared panel changes also require the desktop sync skill and its Electron smoke test; add platform support in `apps/desktop/src/vscode-host.ts` rather than maintaining a second panel implementation.

apps/extension/webview/lib.ts provides DOM helpers and RPC; grid.ts owns the shared grid. Read the corresponding apps/extension/src/panels/ consumer before changing messages. Preserve keyboard navigation, VS Code theme variables and escaped rendering of database values. Keep secrets out of persisted webview state.
The connection form uses React and apps/extension/webview/ui components; other panels use DOM helpers. Follow the approach in the affected area. Check types, build, and verify visible changes with F5 in VS Code.
