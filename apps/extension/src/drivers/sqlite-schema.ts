import { ColumnMeta, DbNode, TableRef } from '../types';
import { SqlDriver } from './sql';

// SQLite metadata is shared by local files and Cloudflare D1.
export abstract class SqliteSchemaDriver extends SqlDriver {
  readonly dialect = 'sqlite' as const;
  protected abstract rows<T>(sql: string, params?: unknown[]): Promise<T[]>;
  protected abstract databaseLabel(database: string): string;

  protected schemaDatabase(database?: string): string {
    return database || 'main';
  }

  async databases(): Promise<string[]> {
    return (await this.rows<{ name: string }>('SELECT name FROM pragma_database_list WHERE name <> ? ORDER BY seq', ['temp'])).map((r) => r.name);
  }

  private hidden(): string {
    return this.config.showSystem ? '' : "AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'";
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const dbs = await this.databases();
      return dbs.map((d) => this.node('database', this.databaseLabel(d), { database: d, icon: 'database', tooltip: this.config.database, tags: 'database sql', expanded: true }));
    }
    const db = n.database!;
    if (n.kind === 'database') {
      return [
        this.node('folder', 'Tables', { database: db, ref: 'tables', icon: 'folder-library', tags: 'folder', expanded: true }),
        this.node('folder', 'Views', { database: db, ref: 'views', icon: 'folder-library', tags: 'folder' }),
      ];
    }
    if (n.kind === 'folder' && (n.ref === 'tables' || n.ref === 'views')) {
      const isTable = n.ref === 'tables';
      const rows = await this.rows<{ name: string }>(`SELECT name FROM ${this.quote(db)}.sqlite_master WHERE type = ? ${this.hidden()} ORDER BY name`, [
        isTable ? 'table' : 'view',
      ]);
      return rows.map((r) =>
        this.node(isTable ? 'table' : 'view', r.name, { database: db, table: r.name, icon: isTable ? 'table' : 'eye', tags: `${isTable ? 'table' : 'view'} sql` }),
      );
    }
    if (n.kind === 'table' || n.kind === 'view') {
      const cols = await this.columns({ database: db, table: n.table! });
      return cols.map((c) =>
        this.node('column', c.name, {
          database: db,
          table: n.table,
          description: `${c.type || 'any'}${c.nullable ? '' : ' · not null'}`,
          icon: c.pk ? 'key' : 'symbol-field',
          color: c.pk ? 'charts.yellow' : undefined,
          leaf: true,
          tags: 'column',
        }),
      );
    }
    return [];
  }

  async columns(t: TableRef): Promise<ColumnMeta[]> {
    const rows = await this.rows<{ name: string; type: string; notnull: number | bigint; dflt_value: string | null; pk: number | bigint }>(
      'SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?, ?) ORDER BY cid',
      [t.table, this.schemaDatabase(t.database)],
    );
    return rows.map((r) => ({ name: r.name, type: r.type.toLowerCase(), nullable: !Number(r.notnull), defaultValue: r.dflt_value, pk: Number(r.pk) > 0 }));
  }

  async objects(database?: string, _schema?: string, limit: number | null = 5000): Promise<{ name: string }[]> {
    return (
      await this.rows<{ name: string }>(
        `SELECT name FROM ${this.quote(this.schemaDatabase(database))}.sqlite_master WHERE type IN ('table', 'view') ${this.hidden()} ORDER BY name ${limit === null ? '' : `LIMIT ${limit}`}`,
      )
    ).map((r) => ({ name: r.name }));
  }

  async foreignKeys(database = 'main'): Promise<{ name: string; table: string; column: string; target: string; targetColumn: string | null }[]> {
    database = this.schemaDatabase(database);
    return this.rows(
      `SELECT m.name || '.' || f.id AS name, m.name AS "table", f."from" AS "column", f."table" AS target, f."to" AS targetColumn
       FROM ${this.quote(database)}.sqlite_master m JOIN pragma_foreign_key_list(m.name, ?) f
       WHERE m.type = 'table' ORDER BY m.name, f.id, f.seq`,
      [database],
    );
  }

  async ddl(t: TableRef, _kind: string): Promise<string> {
    const rows = await this.rows<{ sql: string }>(
      `SELECT sql FROM ${this.quote(this.schemaDatabase(t.database))}.sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY type IN ('table', 'view') DESC, type, name`,
      [t.table],
    );
    return rows.map((r) => `${r.sql};`).join('\n\n');
  }
}
