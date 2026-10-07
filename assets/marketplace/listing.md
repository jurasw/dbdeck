# Store listing

Fields for the Visual Studio Marketplace publisher form, the extension listing and Open VSX. The extension manifest (`apps/extension/package.json`) already carries the name, description, categories, keywords, icon and links; the Marketplace reads them from the VSIX. Fill the rest by hand.

## Publisher (marketplace.visualstudio.com/manage → Create publisher)

| Field | Value |
| --- | --- |
| Name | DBDeck |
| ID | `dbdeck` (permanent, must match `publisher` in package.json) |
| Description | Free, open source developer tools for working with databases in your editor. |
| Company website | https://dbdeck.dev |
| Logo | `assets/brand/icon-256.png` |
| Support | https://github.com/jurasw/dbdeck/issues |
| Source code repository | https://github.com/jurasw/dbdeck |
| LinkedIn / X | leave empty |

Verified domain (blue check) is optional. Microsoft requires 6 months of published extensions and a domain registered for 6 months, so `dbdeck.dev` qualifies from April 2027.

## Extension

| Field | Value |
| --- | --- |
| Display name | DBDeck — Database Client |
| Identifier | `dbdeck.dbdeck` |
| Short description | Free database client for MySQL, PostgreSQL, ClickHouse, MongoDB, Redis, Elasticsearch, S3 and Docker. No paywalls, no telemetry. |
| Categories | Programming Languages, Other |
| Tags | mysql, postgres, postgresql, mongodb, redis, elasticsearch, clickhouse, s3, minio, docker, database, sql, omnisearch |
| Pricing | Free |
| License | MIT |
| Homepage | https://dbdeck.dev |
| Repository | https://github.com/jurasw/dbdeck |
| Issues | https://github.com/jurasw/dbdeck/issues |
| Q&A | GitHub issues (default) |
| Preview badge | on (`"preview": true`) |
| Long description | `apps/extension/README.md` (packaged into the VSIX) |
| Changelog | `apps/extension/CHANGELOG.md` (packaged into the VSIX) |

## AI filters

Describe a filter in the SQL table’s WHERE field and click the sparkle button to generate a condition from that table’s schema. DBDeck applies it right away; edit the condition and press Enter to refine it. If AI is not connected, DBDeck opens **AI settings**; connect a provider, choose a model and use **Back to table** to return with your text preserved.

AI Query builds its context automatically: from a schema it uses that schema, from a table or database it uses the whole database with the current table first. The compact composer includes the Generate query action inside the input area; expand Database context to inspect or search the included tables.

## Screenshots

Fast first-page results appear with the panel; wide tables render only visible rows and columns to keep scrolling responsive.

Used in the extension README and on dbdeck.dev, in this order:

1. `screenshots/data-grid.png` — connection tree and the customers table in the data grid
2. `screenshots/sql-editor.png` — SQL editor with a join and the Query Results panel
3. `screenshots/schema-diagram.png` — schema diagram with foreign key links
4. `screenshots/redis.png` — Redis key tree and hash editor

## Open VSX (open-vsx.org)

| Field | Value |
| --- | --- |
| Namespace | `dbdeck` |
| Extension | same VSIX as the Marketplace |
| Namespace website | https://dbdeck.dev |

## Social / announcement text

> DBDeck is a free, open source database client for VS Code and Cursor. PostgreSQL, MySQL, ClickHouse, MongoDB, Redis, Elasticsearch, S3 and Docker in one sidebar, with a SQL editor, data grid, schema diagrams and SSH tunnels. No account, no paywall, no telemetry. https://dbdeck.dev

## Search all values

Omnisearch finds values across a database or schema in PostgreSQL, MySQL / MariaDB, ClickHouse and MongoDB. Click the document-with-magnifier icon beside a database or schema and type `JUREK` to see `players — Jurek (name)`. Open a result in a filtered data tab. Previews include up to 20 matching rows per table and 200 distinct table/column/value results overall, with visible limits and skipped objects.

Search beyond the current page in the current table, collection or index, with immediate search and a spinner in the search field while results load. MongoDB includes nested values and arrays; Elasticsearch searches indexed fields.
