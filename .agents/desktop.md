# Desktop demo

`apps/desktop` is a separate npm package hosting the extension's source and webviews in Electron. Read its README and `src/vscode-host.ts` before changing platform integration. Extend the adapter when a shared panel needs another platform capability; keep database behavior, validation, RPC handlers and rendering in the extension.

Use Node 22. Run `npm run validate` and `npm run test:smoke` in `apps/desktop`. Builds rebuild the extension assets and sync the demo version. The smoke test uses disposable data. Package on macOS with `npm run package` and inspect both DMGs; publishing or website deployment follows the root release boundary.

Keep the Demo label visible. Use macOS Keychain encryption for remembered secrets and session memory when Remember password is disabled. Keep renderer Node access disabled, context isolation and sandbox enabled, restrict IPC to registered windows and only serve packaged panel resources. Do not add arbitrary filesystem, shell or IPC access to the preload.

`apps/web/content/desktop-demo.json` enables landing downloads only after the matching GitHub prerelease assets exist. Keep DMGs out of the Cloudflare static assets.
