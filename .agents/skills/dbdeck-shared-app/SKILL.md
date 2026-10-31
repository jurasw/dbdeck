---
name: dbdeck-shared-app
description: Keep DBDeck extension and browser dashboard behavior and design synchronized when changing either application or their local connector.
---

# Shared DBDeck application

The browser dashboard in `apps/dashboard` runs the production extension through its local connector and reuses the extension's compiled webviews, shadcn components, drivers, commands and panels. Trace the shared source in `apps/extension` before editing either app. Fix shared behavior there rather than creating a second implementation in the dashboard. Rebuild both products after a shared change. Extend the browser platform adapter when shared code introduces a new VS Code API.

Browser privacy settings are intentionally web-only: optional project encryption by phrase or supported WebAuthn PRF passkey, inactivity concealment and lock screens. Do not add these settings or a mandatory login to the desktop extension. New browser workspaces open without a password unless the user enabled protection.

The hosted dashboard contains static application assets only. Store project state in the client's browser; execute Node/TCP/SSH drivers in a paired loopback connector on that client's computer. Keep connector state in memory and dispose it on project lock or client timeout. Never introduce hosted credential, connection, query or result persistence. Use an exact allowed origin, loopback Host checks and a random pairing token. Pairing is separate from optional user-facing project protection.

Use the extension's shadcn components and theme tokens for shared UI; match the landing page's DBDeck brand. Passkeys must derive the encryption key through PRF and require user verification. A UI-only biometric prompt must not be presented as encrypted protection. The OS decides whether verification uses Touch ID, Windows Hello, a PIN or another method. Preserve a clear fallback when PRF is unsupported.

Run extension validation and dashboard type checks, behavioral tests, static build and browser smoke tests after shared changes. Check command routing, connection storage, table edits, SQL results, optional locking and both app appearances. Apply feature-documentation and local-update recipes when their existing conditions apply. Publishing or deployment still needs an explicit request.
