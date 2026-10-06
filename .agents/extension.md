# Extension host

Read apps/extension/src/extension.ts for command registration, apps/extension/src/connections.ts for storage, apps/extension/src/drivers/ for service behavior, and apps/extension/src/panels/ for host/webview integration.
Preserve dbdeck command/configuration IDs. Keep secrets in SecretStorage or session memory according to Remember password. Preserve read-only handling, confirmations and staged SQL transactions. Use disposable services for integration verification.
