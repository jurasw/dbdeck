<h1 align="center">DBDeck</h1>

<p align="center">
  <b>Your databases. Inside your editor.</b><br>
  A free, open-source database client for VS Code and Cursor.<br>
  No accounts, paywalls, telemetry or cloud sync.
</p>

<p align="center">
  <a href="https://dbdeck.dev">Website</a> ·
  <a href="https://github.com/jurasw/dbdeck">GitHub</a> ·
  <a href="https://github.com/jurasw/dbdeck/issues/new/choose">Report a bug</a>
</p>

![Data grid with the connection tree](https://raw.githubusercontent.com/jurasw/dbdeck/main/assets/screenshots/data-grid.png)

## What it does

Browse databases, run queries and edit data without leaving your editor. Keep connections together, use SSH tunnels and inspect results in a virtualized grid.

| Service                     | Tools                                                         |
| --------------------------- | ------------------------------------------------------------- |
| PostgreSQL, MySQL / MariaDB | SQL editor, data grid, primary-key row editing, DDL           |
| ClickHouse                  | SQL editor, data browsing, DDL                                |
| MongoDB                     | Document editor, filters, aggregation and shell-style scripts |
| Redis                       | Key browser, value editors, TTL, CLI                          |
| Elasticsearch / OpenSearch  | Index browser, documents and request console                  |
| S3 / MinIO / R2             | Buckets, folders, uploads and downloads                       |
| Docker                      | Containers, logs, shell and database connection discovery     |

## Features

- Connection tree with groups, per-type icons and connection status
- SSH tunnels (password or private key), SSL/TLS, read-only mode
- Data viewer with a virtualized grid: server-side paging, sorting, `WHERE` / `ORDER BY` filters, column resize, keyboard navigation, copy as TSV / JSON / `INSERT`
- Inline editing for PostgreSQL and MySQL tables with a primary key: edit cells, add, duplicate and delete rows, set `NULL`. Changes are staged and saved in one transaction
- SQL editor: run the statement under the cursor (`⌘/Ctrl+Enter`), run all (`⌘/Ctrl+Shift+Enter`), `▶ Run` CodeLens, table and column completion with alias resolution
- Results panel: one tab per statement, row filter, JSON view, export to CSV / JSON
- DDL for tables, views, functions and procedures; truncate and drop
- MongoDB: document grid and JSON view, filter / sort / projection, edit / insert / clone / delete documents, shell-style scripts (`db.users.find({...}).sort(...)`, `aggregate`, `ObjectId()`, `ISODate()`)
- Redis: key tree grouped by separator, SCAN filter, editors for string (text / JSON), hash, list, set, sorted set, stream and RedisJSON, TTL and rename, built-in CLI terminal
- Elasticsearch: index list with health, field mapping, document search (query string or DSL), edit / add / delete documents, Kibana-style request console (`.esreq` files)
- S3: buckets and folders in the tree, open / download / upload / delete objects, copy `s3://` URI; works with AWS, MinIO, Cloudflare R2 and other S3-compatible servers
- Docker: containers grouped by Compose project, start / stop / restart / remove, logs, shell, inspect, images, volumes, networks, and **Add as Database Connection** that reads credentials from container env

## Getting started

Install **DBDeck** from the Extensions view in VS Code (Visual Studio Marketplace) or in Cursor, VSCodium and Windsurf (Open VSX). You can also download the VSIX from [GitHub Releases](https://github.com/jurasw/dbdeck/releases) and choose **Extensions: Install from VSIX…**.

Open **DBDeck** in the activity bar, choose **Add Connection**, then select a database type. Open a table or create a query from the connection menu.

| Action                | macOS           | Windows / Linux  |
| --------------------- | --------------- | ---------------- |
| Run current statement | Cmd+Enter       | Ctrl+Enter       |
| Run all statements    | Cmd+Shift+Enter | Ctrl+Shift+Enter |

## Screenshots

![SQL editor with query results](https://raw.githubusercontent.com/jurasw/dbdeck/main/assets/screenshots/sql-editor.png)

![Schema diagram with foreign key links](https://raw.githubusercontent.com/jurasw/dbdeck/main/assets/screenshots/schema-diagram.png)

![Redis key browser and hash editor](https://raw.githubusercontent.com/jurasw/dbdeck/main/assets/screenshots/redis.png)

## Privacy

DBDeck makes network connections only to the databases you configure. Nothing is sent anywhere else.

- Connection settings are stored in VS Code / Cursor global state on this machine.
- Passwords, API keys and connection strings are stored in the OS keychain through VS Code SecretStorage.
- Turn off **Remember password** on a connection to keep its secrets in memory only: you are asked for them once per session and nothing is written to disk.
- Query results are not stored.

## Schema diagram

Choose **Show Schema Diagram** on a SQL database or PostgreSQL schema in Connections. Tables show columns, primary keys and foreign keys, with column-to-column relationship lines for PostgreSQL and MySQL/MariaDB. Drag table headers to arrange cards, drag the dotted canvas to pan, and scroll to zoom. Use **Fit**, **Arrange**, search and **Refresh** from the toolbar. The panel remembers its layout when restored. ClickHouse displays tables and columns without foreign key relationships. Relationships to tables outside the selected schema/database are omitted.

## AI queries

Use **DBDeck: Generate Query with AI**, the sparkle button on a SQL connection, database or schema and in a SQL editor, or the SQL connection/table context menu. Select the tables to share, describe your request in any language, and review the generated SQL. **Open in query editor** creates a query bound to the selected connection; it does not execute it. PostgreSQL, MySQL and ClickHouse are supported.

Choose **OpenAI · Continue with ChatGPT** to authorize DBDeck directly through OpenAI using your own eligible ChatGPT plan or credits. DBDeck uses OpenAI's public Responses API and your account's model catalog. Manage access and limits in [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage). Availability depends on OpenAI's preview and your account permissions. See [OpenAI's sign-in documentation](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

Choose **Anthropic · Claude API key** to use Claude with a key from [Claude Console](https://platform.claude.com/). Anthropic does not allow third-party apps to sign in with a Claude.ai account, so Claude Pro and Max subscribers connect Claude Code to DBDeck through MCP instead (see below).

Alternatively, supply your own OpenAI API key, an OpenAI-compatible provider URL and key, or an installed Ollama model (`http://127.0.0.1:11434/v1`). API charges are paid directly by the user. Remote providers must use HTTPS. Use **DBDeck: Disconnect AI Provider** to remove the active provider's credentials; ChatGPT sign-out also attempts to revoke its renewable session.

DBDeck has no AI backend, credential service or prompt analytics. Requests go from the extension host directly to the chosen provider. Only the written request and selected table/column names, types and key metadata are sent; database rows, passwords and connection strings are excluded. Provider data policies still apply. API keys and ChatGPT credentials are kept in VS Code SecretStorage, outside webview state and project files. Provider/model preferences and a stable local OAuth host identifier are stored in the editor. ChatGPT account registrations are kept separately; sign-out removes tokens while retaining the registration for later sign-in. No OpenAI client secret or publisher-owned API key is required.

## AI agents (MCP)

Run **DBDeck: Connect AI Agents (MCP)** to start a local MCP server. Agents can then list your SQL connections, inspect tables and columns, run read-only queries and open SQL in a query editor for you to review. Agents work with your own AI subscription, for example Claude Code with a Claude Pro or Max plan.

- VS Code and Cursor see DBDeck automatically while the server runs.
- For Claude Code, choose **Copy Claude Code command** and run it in a terminal. **Copy MCP JSON config** works for Claude Desktop, Windsurf and other clients.
- Before an agent reads a connection for the first time, DBDeck asks you. **Forget allowed connections** resets these answers.
- `run_query` runs one SELECT, WITH, SHOW, DESCRIBE or EXPLAIN statement in a read-only transaction (ClickHouse: `readonly=1`) with a 30-second limit. Up to `dbdeck.mcp.maxRows` rows (default 200) go back to the agent.
- `open_query` never runs SQL. Inserts, updates and schema changes open in a query editor so you run them yourself.
- The server listens on `127.0.0.1` only and needs an access token kept in SecretStorage. **Regenerate access token** replaces it. Turn the server off from the same command or with `dbdeck.mcp.enabled`.

Query results that an agent reads are sent to that agent's AI provider. For full protection on production, give the connection a database user with read-only privileges.

## License

[MIT](https://github.com/jurasw/dbdeck/blob/main/LICENSE).
