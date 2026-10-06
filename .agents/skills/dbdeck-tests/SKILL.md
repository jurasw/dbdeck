---
name: dbdeck-tests
description: Write and run DBDeck behavioral specs or reproduce extension and driver bugs.
---

# Dbdeck Tests

Read the affected area rules. Specs live in apps/extension/test/<area>.spec.ts and use node:test and node:assert/strict. npm test bundles TypeScript specs with esbuild and executes Node's runner. Execute production functions and assert outputs, state or errors; never grep implementation files as proof. The automated suite does not launch VS Code or databases. Use F5 and disposable Compose services for integration work and report manual checks separately. Run npm run check and npm test in apps/extension.
