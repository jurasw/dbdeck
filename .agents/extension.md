# Extension host

Read src/extension.ts for command registration, src/connections.ts for storage, src/drivers/ for service behavior, and src/panels/ for host/webview integration.
Preserve dbdeck command/configuration IDs. Keep secrets in SecretStorage or session memory according to Remember password. Preserve read-only handling, confirmations and staged SQL transactions. Use disposable services for integration verification.
