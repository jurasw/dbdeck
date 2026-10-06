<h1 align="center">DBDeck</h1>

<p align="center">
  <b>Your databases. Inside your editor.</b><br>
  A free, open-source database client for VS Code and Cursor.<br>
  No accounts, paywalls, telemetry or cloud sync.
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-1f883d"></a>
  <a href="https://github.com/jurasw/dbdeck/actions/workflows/extension-check-on-pr.yml"><img alt="Extension checks" src="https://github.com/jurasw/dbdeck/actions/workflows/extension-check-on-pr.yml/badge.svg"></a>
  <a href="https://github.com/jurasw/dbdeck/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/jurasw/dbdeck"></a>
  <a href="./CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen"></a>
</p>

<p align="center">
  <a href="#getting-started">Get started</a> ·
  <a href="./CONTRIBUTING.md">Contribute</a> ·
  <a href="https://github.com/jurasw/dbdeck/issues/new/choose">Report a bug</a>
</p>

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
- Inline editing for PostgreSQL and MySQL tables with a primary key: edit cells, add rows, delete rows, set `NULL`. Changes are staged and saved in one transaction
- SQL editor: run the statement under the cursor (`⌘/Ctrl+Enter`), run all (`⌘/Ctrl+Shift+Enter`), `▶ Run` CodeLens, table and column completion with alias resolution
- Results panel: one tab per statement, row filter, JSON view, export to CSV / JSON
- DDL for tables, views, functions and procedures; truncate and drop
- MongoDB: document grid and JSON view, filter / sort / projection, edit / insert / clone / delete documents, shell-style scripts (`db.users.find({...}).sort(...)`, `aggregate`, `ObjectId()`, `ISODate()`)
- Redis: key tree grouped by separator, SCAN filter, editors for string (text / JSON), hash, list, set, sorted set, stream and RedisJSON, TTL and rename, built-in CLI terminal
- Elasticsearch: index list with health, field mapping, document search (query string or DSL), edit / add / delete documents, Kibana-style request console (`.esreq` files)
- S3: buckets and folders in the tree, open / download / upload / delete objects, copy `s3://` URI; works with AWS, MinIO, Cloudflare R2 and other S3-compatible servers
- Docker: containers grouped by Compose project, start / stop / restart / remove, logs, shell, inspect, images, volumes, networks, and **Add as Database Connection** that reads credentials from container env

## Getting started

DBDeck is an unreleased preview. Install a locally built VSIX while Marketplace publication is being prepared.

```bash
nvm use
npm ci
npm run package
code --install-extension dbdeck-0.1.0.vsix
# Or install in Cursor:
cursor --install-extension dbdeck-0.1.0.vsix
```

Open **DBDeck** in the activity bar, choose **Add Connection**, then select a database type. Open a table or create a query from the connection menu.

| Action                | macOS           | Windows / Linux  |
| --------------------- | --------------- | ---------------- |
| Run current statement | Cmd+Enter       | Ctrl+Enter       |
| Run all statements    | Cmd+Shift+Enter | Ctrl+Shift+Enter |

## Privacy

DBDeck makes network connections only to the databases you configure. Nothing is sent anywhere else.

- Connection settings are stored in VS Code / Cursor global state on this machine.
- Passwords, API keys and connection strings are stored in the OS keychain through VS Code SecretStorage.
- Turn off **Remember password** on a connection to keep its secrets in memory only: you are asked for them once per session and nothing is written to disk.
- Query results are not stored.

## Project structure

```text
dbdeck/
├── src/                 # Extension host, connections, drivers and panels
├── webview/             # Data grid, results and connection UI
├── media/               # Extension icons
├── syntaxes/            # Elasticsearch request language
├── test/                # Behavioral specs and local database services
├── scripts/             # TypeScript test bundling with Node's test runner
├── .agents/skills/      # Repository task recipes
└── .github/workflows/   # Validation and VSIX artifacts
```

## Development

Use Node.js 22 and npm with the committed lockfile.

```bash
npm ci
npm run watch
```

Press **F5** in VS Code to start an Extension Development Host.

| Command                 | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `npm run check`         | Type check extension and webviews                   |
| `npm run lint`          | Oxlint and Prettier checks                          |
| `npm run format`        | Format repository files                             |
| `npm test`              | Run behavioral specs; no database services required |
| `npm run build`         | Build extension and webviews                        |
| `npm run validate`      | Check, lint, test and build                         |
| `npm run package:check` | List files included in the VSIX                     |
| `npm run package`       | Build a production VSIX locally                     |

`test/docker-compose.yml` starts supported database services on non-default ports for manual integration testing. It is separate from the automated unit suite.

## CI and release preparation

Pull requests and pushes to `main` run type checks, lint, tests, a build and packaging. The manually triggered **Package Extension** workflow validates and uploads a VSIX artifact for review. Neither workflow publishes an extension or creates a release.

See [Marketplace preparation](docs/marketplace.md) for publisher, listing and final verification steps.

## Technologies

TypeScript, the VS Code extension API, esbuild, React, Tailwind CSS, Node's test runner, Oxlint and Prettier. Database drivers run in the extension host; the webviews display results and send requests to the host.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for naming, checks and pull requests. Agent instructions are in [AGENTS.md](AGENTS.md), with area rules and skills in `.agents/`.

## License

[MIT](LICENSE).
