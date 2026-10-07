import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { ColumnMeta, DbNode, QueryResult, TableRef } from '../types';
import { expandHome, toCell } from '../util';
import { Exec, SqlDriver } from './sql';

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
  columns(): { name: string; type: string | null }[];
  setReturnArrays(enabled: boolean): void;
  setReadBigInts(enabled: boolean): void;
}

interface SqliteDatabase {
  readonly isTransaction: boolean;
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean; timeout?: number }) => SqliteDatabase;
  StatementSync?: { prototype: Partial<SqliteStatement> };
}

function sqlite(): SqliteModule {
  let mod: SqliteModule | undefined;
  try {
    mod = require('node:sqlite') as SqliteModule;
  } catch {
    mod = undefined;
  }
  if (typeof mod?.StatementSync?.prototype.setReturnArrays !== 'function' || typeof mod.StatementSync.prototype.columns !== 'function')
    throw new Error('SQLite needs a newer editor. Update VS Code or Cursor and try again.');
  return mod;
}

export function sqliteCell(v: unknown): unknown {
  if (typeof v === 'bigint') return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  return toCell(v);
}

function sqliteParam(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

export class SqliteDriver extends SqlDriver {
  readonly dialect = 'sqlite' as const;
  private db?: SqliteDatabase;

  get file(): string {
    return expandHome(this.config.database?.trim() ?? '');
  }

  private open(readOnly: boolean): SqliteDatabase {
    const file = this.file;
    if (!file) throw new Error('Choose a SQLite database file.');
    if (!existsSync(file)) throw new Error(`File not found: ${file}`);
    return new (sqlite().DatabaseSync)(file, { readOnly, timeout: 5000 });
  }

  private get handle(): SqliteDatabase {
    if (!this.db) throw new Error('Not connected');
    return this.db;
  }

  async connect(): Promise<void> {
    const db = this.open(!!this.config.readonly);
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').all();
    } catch (e) {
      db.close();
      throw e;
    }
    this.db = db;
  }

  protected async disconnect(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  protected param(): string {
    return '?';
  }

  private execute(db: SqliteDatabase, sql: string, params: unknown[] = []): QueryResult {
    const t = Date.now();
    const stmt = db.prepare(sql);
    stmt.setReadBigInts(true);
    const columns = stmt.columns();
    const values = params.map(sqliteParam);
    if (!columns.length) {
      const changes = Number(stmt.run(...values).changes);
      return { columns: [], rows: [], affectedRows: changes, message: `${changes} row(s) affected`, durationMs: Date.now() - t };
    }
    stmt.setReturnArrays(true);
    const rows = stmt.all(...values) as unknown[][];
    return {
      columns: columns.map((c) => ({ name: c.name, type: c.type?.toLowerCase() || undefined })),
      rows: rows.map((r) => r.map(sqliteCell)),
      durationMs: Date.now() - t,
    };
  }

  private rows<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.handle.prepare(sql);
    return stmt.all(...params.map(sqliteParam)) as T[];
  }

  async run(sql: string, _database?: string, params?: unknown[]): Promise<QueryResult> {
    return this.execute(this.handle, sql, params);
  }

  protected async readOnly(sql: string): Promise<QueryResult> {
    const db = this.open(true);
    try {
      return this.execute(db, sql);
    } finally {
      db.close();
    }
  }

  protected async transaction(_database: string | undefined, statements: Exec[]): Promise<number> {
    const db = this.handle;
    let total = 0;
    db.exec('BEGIN');
    try {
      for (const s of statements) total += Number(db.prepare(s.sql).run(...s.params.map(sqliteParam)).changes);
      db.exec('COMMIT');
      return total;
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    }
  }

  async databases(): Promise<string[]> {
    return this.rows<{ name: string }>('SELECT name FROM pragma_database_list WHERE name <> ? ORDER BY seq', ['temp']).map((r) => r.name);
  }

  private hidden(): string {
    return this.config.showSystem ? '' : "AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'";
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const dbs = await this.databases();
      return dbs.map((d) =>
        this.node('database', d === 'main' ? basename(this.file) : d, { database: d, icon: 'database', tooltip: this.file, tags: 'database sql', expanded: true }),
      );
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
      const rows = this.rows<{ name: string }>(`SELECT name FROM ${this.quote(db)}.sqlite_master WHERE type = ? ${this.hidden()} ORDER BY name`, [isTable ? 'table' : 'view']);
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
    const rows = this.rows<{ name: string; type: string; notnull: number | bigint; dflt_value: string | null; pk: number | bigint }>(
      'SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?, ?) ORDER BY cid',
      [t.table, t.database || 'main'],
    );
    return rows.map((r) => ({ name: r.name, type: r.type.toLowerCase(), nullable: !Number(r.notnull), defaultValue: r.dflt_value, pk: Number(r.pk) > 0 }));
  }

  async objects(database?: string, _schema?: string, limit: number | null = 5000): Promise<{ name: string }[]> {
    return this.rows<{ name: string }>(
      `SELECT name FROM ${this.quote(database || 'main')}.sqlite_master WHERE type IN ('table', 'view') ${this.hidden()} ORDER BY name ${limit === null ? '' : `LIMIT ${limit}`}`,
    );
  }

  async foreignKeys(database = 'main'): Promise<{ name: string; table: string; column: string; target: string; targetColumn: string | null }[]> {
    return this.rows(
      `SELECT m.name || '.' || f.id AS name, m.name AS "table", f."from" AS "column", f."table" AS target, f."to" AS targetColumn
       FROM ${this.quote(database)}.sqlite_master m JOIN pragma_foreign_key_list(m.name, ?) f
       WHERE m.type = 'table' ORDER BY m.name, f.id, f.seq`,
      [database],
    );
  }

  async ddl(t: TableRef, _kind: string): Promise<string> {
    const rows = this.rows<{ sql: string }>(
      `SELECT sql FROM ${this.quote(t.database || 'main')}.sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY type IN ('table', 'view') DESC, type, name`,
      [t.table],
    );
    return rows.map((r) => `${r.sql};`).join('\n\n');
  }
}
