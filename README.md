# DBDeck — Database Client

Free database client for **VS Code** and **Cursor**. No paywalls, accounts, telemetry or cloud sync.

Supported: **PostgreSQL**, **MySQL / MariaDB**, **ClickHouse**, **MongoDB**, **Redis**, **Elasticsearch / OpenSearch**, **Docker**.

## Features

- Connection tree with groups, per-type icons and connection status
- SSH tunnels (password or private key), SSL/TLS, read-only mode
- Data viewer with a virtualized grid: server-side paging, sorting, `WHERE` / `ORDER BY` filters, column resize, keyboard navigation, copy as TSV / JSON / `INSERT`
- Inline editing for PostgreSQL and MySQL tables with a primary key: edit cells, add rows, delete rows, set `NULL`. Changes are staged and saved in one transaction
- SQL editor: run the statement under the cursor (`⌘/Ctrl+Enter`), run all (`⌘/Ctrl+Shift+Enter`), `▶ Run` CodeLens, table and column completion with alias resolution
- Results panel: one tab per statement, row filter, JSON view, export to CSV / JSON
- DDL for tables, views, functions and procedures; truncate and drop
- MongoDB: document grid and JSON view, filter / sort / projection, edit / insert / clone / delete documents, shell-style scripts (`db.users.find({...}).sort(...)`, `aggregate`, `ObjectId()`, `ISODate()`)
- Redis: key tree grouped by separator, SCAN filter, editors for string (text / JSON), hash, list, set, sorted set, stream and RedisJSON, TTL and rename, built-in CLI terminal
- Elasticsearch: index list with health, field mapping, document search (query string or DSL), edit / add / delete documents, Kibana-style request console (`.esreq` files)
- Docker: containers grouped by Compose project, start / stop / restart / remove, logs, shell, inspect, images, volumes, networks, and **Add as Database Connection** that reads credentials from container env

## Privacy

DBDeck makes network connections only to the databases you configure. Nothing is sent anywhere else.

- Connection settings are stored in VS Code / Cursor global state on this machine.
- Passwords, API keys and connection strings are stored in the OS keychain through VS Code SecretStorage.
- Turn off **Remember password** on a connection to keep its secrets in memory only: you are asked for them once per session and nothing is written to disk.
- Query results are not stored.

## Install

```bash
npm install
npm run package
code --install-extension dbdeck-0.1.0.vsix
cursor --install-extension dbdeck-0.1.0.vsix
```

## Develop

```bash
npm install
npm run watch
```

Press `F5` in VS Code to start an Extension Development Host.

`test/docker-compose.yml` starts every supported database on non-default ports for local testing.

## License

MIT
