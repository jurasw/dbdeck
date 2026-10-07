# Changelog

## 0.3.2 — 2026-10-07

- Fixed the Docker icon on the landing page to match the connection icon.
- Added BigQuery and Snowflake connections. BigQuery signs in with gcloud application default credentials or a service account key, lists datasets and tables, previews tables for free through the BigQuery API and shows the bytes each query processes. Snowflake signs in with a programmatic access token or a key pair and lists databases, schemas, tables and views. Both support the SQL editor, data browsing, DDL, Omnisearch, schema diagrams, AI queries and the MCP server; the grid is read-only.
- DBDeck panels follow the editor color theme: buttons, focus rings, inputs, menus, dialogs, row hover and selection, status colors and value colors use the active VS Code or Cursor theme.
- Fixed tables that opened slowly while row counts of other large tables were still running. Counts no longer block page loads, and PostgreSQL connections stay open longer, so remote databases such as Supabase reconnect less often.
- Tables open in a preview tab, like files in the explorer. Opening another table reuses the running panel instead of starting a new one, so switching tables no longer waits about a second for the editor to start a panel. The tab stays open once you filter, sort, search, page, edit or open the same table again.
- Opening DBDeck with no open editors shows a start tab with your recent tables. The first table you open replaces it, so it appears at once instead of waiting about a second for the editor to start its first panel.

## 0.3.1 — 2026-10-07

- Fixed table startup to include fast first-page results and icons in the panel's first document. Wide grids render only visible columns and avoid redundant repaints while scrolling.

## 0.3.0 — 2026-10-07

- Added Omnisearch beside databases and schemas: search values across PostgreSQL, MySQL / MariaDB, ClickHouse and MongoDB, preview table/value/column matches and open filtered data tabs. Includes nested MongoDB fields, progressive results, visible preview limits and skipped objects.

- Fixed initial table loading to fetch rows while the panel starts, reuse the first result without a duplicate query, and clarify that the displayed duration measures the database query.

- Fixed crowding in the table action bar by keeping Duplicate and Delete in the row context menu, placing search and Add row together on the left, and aligning the search buttons.

- Fixed the full-record search layout with a compact field in the table action bar and a spinner while results load, without a confirmation dialog.

- Simplified the landing page with animated service icons and larger SQL, schema and Redis examples, plus a dedicated AI integration section.

- Added Search all records across the current table, collection or index, with paginated matches.

- Fixed website section navigation to scroll without adding a fragment to the URL.
- Added website SEO metadata, a canonical URL, sitemap, robots.txt and structured data for DBDeck.

- Tables, collections and other panels open faster: styles and scripts ship inside the panel, and a skeleton grid shows until the first rows arrive.

- Saved row and document edits show **Undo** in the confirmation toast, so an accidental change can be reverted with one click.

- AI Query opened from a table includes the whole database as context, so questions about other schemas and tables work.

- AI filters type into the WHERE field with a glowing border while generating, then apply the filter to the table right away. AI Query streams the generated SQL into the preview.

- Schema diagrams draw tables and relationship lines in on open, show dots flowing along foreign keys and highlight a table's relations and related tables on hover or search.

- Added a spinner to the WHERE field AI button while a filter is being generated.

- SQL tree actions show New Query and Show Schema Diagram side by side. Generate query with AI is available below SQL in the query editor and in the context menu.

- Refined AI Query with a compact composer, automatic context from the originating table, schema or database, searchable context preview and generation controls inside the input area.

- Generate SQL table WHERE filters with the sparkle button. Missing AI setup opens settings with a Back to table action and preserves the filter text.

- Fixed scrolling in AI Query and grouped provider, model and account controls in a AI settings panel opened with the circular gear beside AI agents.

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
