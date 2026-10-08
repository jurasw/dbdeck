---
name: dbdeck-driver
description: Extend or fix DBDeck database and service drivers and their tree/panel integration.
---

# Dbdeck Driver

Desktop demo imports these drivers directly. After driver or tree/panel integration changes, apply `../dbdeck-desktop-sync/SKILL.md` to rebuild and validate desktop against the shared implementation.

Read .agents/extension.md and trace the relevant driver, apps/extension/src/drivers/base.ts, apps/extension/src/types.ts, tree and panels. For SQL changes inspect SqlDriver paging, quoting, parameter binding, read-only behavior and transactions. Preserve service-specific semantics. A new service requires connection form, driver creation, tree nodes, commands and icons. Test pure behavior with executable specs and service behavior with disposable instances from apps/extension/test/docker-compose.yml. Run npm run validate in apps/extension.
