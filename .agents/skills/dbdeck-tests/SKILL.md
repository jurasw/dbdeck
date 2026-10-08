---
name: dbdeck-tests
description: Write and run DBDeck behavioral specs or reproduce extension and driver bugs.
---

# Dbdeck Tests

Read the affected area rules. Specs live in apps/extension/test/<area>.spec.ts and use node:test and node:assert/strict. npm test bundles TypeScript specs with esbuild and executes Node's runner. Execute production functions and assert outputs, state or errors; never grep implementation files as proof. The automated suite does not launch VS Code or databases. Use F5 and disposable Compose services for integration work and report manual checks separately. Run npm run check and npm test in apps/extension.

Shared extension behavior also ships in the macOS desktop demo. Apply `../dbdeck-desktop-sync/SKILL.md` after shared changes. Desktop behavioral tests are in `apps/desktop/test`; `npm run test:smoke` exercises actual Electron windows with disposable sample SQLite data. Keep shared query and driver assertions in extension specs, and desktop platform/storage assertions in desktop tests.
