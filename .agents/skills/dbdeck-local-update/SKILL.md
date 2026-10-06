---
name: dbdeck-local-update
description: Build and update the locally installed DBDeck extension after changes in this repository.
---

# Local DBDeck update

The user wants their local DBDeck extension updated after changes. After completing implementation, run `npm run validate` with Node 22, then `npm run package:check` and `npm run package`. Install the resulting VSIX with `code --install-extension <vsix-path> --force`. Use the version from package.json to find the artifact; do not bump it just for local installation.

In this workspace `/usr/local/bin/code` currently launches Cursor, where `dbdeck.dbdeck` is installed. Use that existing CLI to update the user's editor. If the CLI target changes, inspect the installed extensions before selecting a target.

Verify `code --list-extensions --show-versions` includes `dbdeck.dbdeck` at the packaged version. Tell the user to reload the editor window to activate the new build. If the CLI is missing or installation fails, report the exact blocker and the available VSIX path; do not claim it was installed.

Local installation is authorized by the user's standing request. Follow sandbox escalation requirements when writing to the editor's extension directory. This does not authorize Marketplace/Open VSX publication, GitHub Releases, publisher registration, or credential setup.
