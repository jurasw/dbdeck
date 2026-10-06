# Webviews

webview/lib.ts provides DOM helpers and RPC; grid.ts owns the shared grid. Read the corresponding src/panels/ consumer before changing messages. Preserve keyboard navigation, VS Code theme variables and escaped rendering of database values. Keep secrets out of persisted webview state.
The connection form uses React and webview/ui components; other panels use DOM helpers. Follow the approach in the affected area. Check types, build, and verify visible changes with F5 in VS Code.
