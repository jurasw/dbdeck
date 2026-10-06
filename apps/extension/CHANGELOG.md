# Changelog

## 0.2.1 — 2026-10-06

- Duplicate rows in PostgreSQL and MySQL tables from the right-click menu or the Duplicate button. Primary keys stay empty so the database fills them.
- Search Database Objects shows the folder and connection of every result.
- Smaller table header in the data panel.
- Generate queries with Claude using your own Anthropic API key.
- Connect AI agents (Claude Code, Cursor, Copilot, Codex) to your SQL connections through a local MCP server. Agents read schema and run read-only queries on connections you allow; changes open in a query editor for your review.
- Sparkle button on SQL connections, databases and schemas opens Generate Query with AI.

## 0.2.0 — 2026-10-06

- AI SQL generation with a preview, selected schema context, Continue with ChatGPT, user-owned API providers and local Ollama.
- Search Database Objects command for tables, views and routines across connections.
- Marketplace icon and listing screenshots.
- Fixed the Query Results panel staying on "Running…" after the first query in a new window.

## 0.1.0 — 2026-10-06

- Initial preview of DBDeck for VS Code and Cursor.
- PostgreSQL, MySQL, ClickHouse, MongoDB, Redis, Elasticsearch, S3 and Docker connections.
- Query editor, data grid, exports, SSH tunnels and local secret storage.
- Interactive SQL schema diagrams with foreign key links, draggable tables, dotted canvas, pan, zoom and search.
