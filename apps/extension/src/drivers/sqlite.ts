import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { QueryResult } from '../types';
import { expandHome, toCell } from '../util';
import { Exec } from './sql';
import { SqliteSchemaDriver } from './sqlite-schema';

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

export class SqliteDriver extends SqliteSchemaDriver {
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

  protected async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
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

  protected databaseLabel(database: string): string {
    return database === 'main' ? basename(this.file) : database;
  }
}
