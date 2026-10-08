# Changelog

## 0.4.2 (2026-10-08)

- Fixed the landing page service icons to fit in two rows, with horizontal scrolling on narrow screens.
- Fixed Kibana connections: the server form separates the Kibana URL, browser login and API key entry, rejects login redirects and HTML pages, and shows readable API access errors even in narrow panels. Session-only Kibana connections ask for the API key on reconnect.
- Fixed missing pointer cursors on buttons, switches and connection form selectors.

- Added Microsoft SQL Server with schema browsing, transactional row editing, DDL, Omnisearch and foreign key diagrams.
- Added DynamoDB table and item browsing, native paging and PartiQL queries, with AWS credentials and custom endpoints.
- Added Cassandra keyspaces, tables, native paging, metadata, DDL and CQL queries. DynamoDB and Cassandra changes run in the query editor.
- Reduced the connection picker to sixteen compact buttons in two rows and sorted databases by Stack Overflow Developer Survey 2026 usage.

- Cloudflare D1 connections use an Account ID, Database ID and API token: browse tables and views, run SQL, search values with Omnisearch, inspect DDL and view foreign keys. The grid is read-only; use the SQL editor for writes.
- Oracle connections use Thin mode without Oracle Client libraries: schemas, SQL and PL/SQL, row editing in a transaction, DDL, Omnisearch and foreign key diagrams. Connect by service name, with optional TLS and SSH tunnels.

- The landing page shows copyable install commands and editor icons for VS Code, Cursor, VSCodium and Windsurf.

## 0.4.1 (2026-10-08)

- The Marketplace and Open VSX page shows animated demos of the data grid, schema diagram and MongoDB editing, and the Omnisearch section sits with the other feature sections.

## 0.4.0 (2026-10-08)

- **Add as Database Connection** on a Docker container recognizes CockroachDB, YugabyteDB, TiDB, SingleStore and FerretDB images and fills their port and default user. OpenSearch containers connect as `admin` over TLS unless the security plugin is off.
- Fixed read-only queries on TiDB, which does not support read-only transactions: value search previews, chat queries and the MCP server now work there. CockroachDB hides its `crdb_internal` schema unless system objects are shown.
- Fixed punctuation in the Omnisearch result labels and Redis CLI prompt.
- SQLite connections open local `.db`, `.sqlite` and `.sqlite3` files: browse tables and views, run SQL, edit rows of tables with a primary key, search with Omnisearch and see foreign keys in the schema diagram. No native modules; DBDeck uses the SQLite built into the editor.
- PostgreSQL, MySQL, ClickHouse and Redis connections take a pasted connection URL, such as one from Neon, Supabase, PlanetScale or Heroku. DBDeck fills host, port, user, password, database and SSL from it and does not keep the URL. A `sqlite:` or `file:` URL switches a new connection to SQLite.
- **Chat with Database** answers questions about a SQL connection in a chat panel. The assistant reads table and column names on its own. Turn on read-only queries to let it run SELECT statements and answer from the results; results then go to your AI provider. SQL in answers opens in a query editor or runs read-only in the chat. Uses the same provider as AI queries.
- The chat panel is a compact assistant in the style of a side panel: an animated assistant mark while it thinks, a greeting with suggestions, Enter to send and a stop button. The sparkle button in a SQL table's header opens it beside the table, with that table as context. A SQL connection shows a chat icon on hover.
- **Settings** in the Connections view's `…` menu gathers AI provider and model, chat query permissions, the MCP server, data viewer, Redis and connection import and export in one page.
- S3 connections open Google Cloud Storage buckets: choose Sign in with Google under Options, then pick a project and a bucket. DBDeck uses your gcloud login, so no access keys are needed. Copy URI gives `gs://` paths for these buckets.
- Elasticsearch connections sign in through Kibana, including company SSO and Elastic Cloud: choose Sign in to Kibana under Options, create an API key in the Kibana page that opens and paste it. DBDeck reaches Elasticsearch through Kibana, or directly on Elastic Cloud.
- BigQuery connections have Sign in with Google under Options and pick the project from a list of your projects.
- S3 and Google Cloud Storage file tooltips show the modified time in local time, such as `2026-10-07 03:40:21`.
- Right-click a connection group to rename it or to delete it with all its connections. Deleting asks for confirmation first.

## 0.3.3 (2026-10-07)

- The start tab with recent tables now also opens when files are open: it loads in the background and the editor returns to the file you had open, so the first table appears at once.
- Fixed new table tabs in Cursor that took about a second to open: each open table panel now gets its own webview origin and releases its service worker after loading, so new tabs open in 60–300 ms.

## 0.3.2 (2026-10-07)

- Fixed the Docker icon on the landing page to match the connection icon.
- Added BigQuery and Snowflake connections. BigQuery signs in with gcloud application default credentials or a service account key, lists datasets and tables, previews tables for free through the BigQuery API and shows the bytes each query processes. Snowflake signs in with a programmatic access token or a key pair and lists databases, schemas, tables and views. Both support the SQL editor, data browsing, DDL, Omnisearch, schema diagrams, AI queries and the MCP server; the grid is read-only.
- DBDeck panels follow the editor color theme: buttons, focus rings, inputs, menus, dialogs, row hover and selection, status colors and value colors use the active VS Code or Cursor theme.
- Fixed tables that opened slowly while row counts of other large tables were still running. Counts no longer block page loads, and PostgreSQL connections stay open longer, so remote databases such as Supabase reconnect less often.
- Tables open in a preview tab, like files in the explorer. Opening another table reuses the running panel instead of starting a new one, so switching tables no longer waits about a second for the editor to start a panel. The tab stays open once you filter, sort, search, page, edit or open the same table again.
- Opening DBDeck with no open editors shows a start tab with your recent tables. The first table you open replaces it, so it appears at once instead of waiting about a second for the editor to start its first panel.

## 0.3.1 (2026-10-07)

- Fixed table startup to include fast first-page results and icons in the panel's first document. Wide grids render only visible columns and avoid redundant repaints while scrolling.

## 0.3.0 (2026-10-07)

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

## 0.2.1 (2026-10-06)

- Duplicate rows in PostgreSQL and MySQL tables from the right-click menu or the Duplicate button. Primary keys stay empty so the database fills them.
- Search Database Objects shows the folder and connection of every result.
- Smaller table header in the data panel.
- Generate queries with Claude using your own Anthropic API key.
- Connect AI agents (Claude Code, Cursor, Copilot, Codex) to your SQL connections through a local MCP server. Agents read schema and run read-only queries on connections you allow; changes open in a query editor for your review.
- Sparkle button on SQL connections, databases and schemas opens Generate Query with AI.

## 0.2.0 (2026-10-06)

- AI SQL generation with a preview, selected schema context, Continue with ChatGPT, user-owned API providers and local Ollama.
- Search Database Objects command for tables, views and routines across connections.
- Marketplace icon and listing screenshots.
- Fixed the Query Results panel staying on "Running…" after the first query in a new window.

## 0.1.0 (2026-10-06)

- Initial preview of DBDeck for VS Code and Cursor.
- PostgreSQL, MySQL, ClickHouse, MongoDB, Redis, Elasticsearch, S3 and Docker connections.
- Query editor, data grid, exports, SSH tunnels and local secret storage.
- Interactive SQL schema diagrams with foreign key links, draggable tables, dotted canvas, pan, zoom and search.
