---
name: dbdeck-driver
description: Extend or fix DBDeck database and service drivers and their tree/panel integration.
---

# Dbdeck Driver

Read .agents/extension.md and trace the relevant driver, src/drivers/base.ts, src/types.ts, tree and panels. For SQL changes inspect SqlDriver paging, quoting, parameter binding, read-only behavior and transactions. Preserve service-specific semantics. A new service requires connection form, driver creation, tree nodes, commands and icons. Test pure behavior with executable specs and service behavior with disposable instances from test/docker-compose.yml. Run npm run validate.
