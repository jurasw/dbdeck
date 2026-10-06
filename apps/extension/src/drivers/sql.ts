import { ColumnMeta, QueryResult, TableRef } from '../types';
import { BaseDriver } from './base';

export interface PageOptions {
  limit: number;
  offset: number;
  where?: string;
  orderBy?: string;
}

export interface RowChanges {
  updates: { key: Record<string, unknown>; values: Record<string, unknown> }[];
  inserts: Record<string, unknown>[];
  deletes: Record<string, unknown>[];
}

export interface Exec {
  sql: string;
  params: unknown[];
}

export abstract class SqlDriver extends BaseDriver {
  abstract readonly dialect: 'mysql' | 'postgres' | 'clickhouse';
  readonly editable: boolean = true;

  abstract run(sql: string, database?: string, params?: unknown[]): Promise<QueryResult>;
  abstract quote(name: string): string;
  abstract columns(t: TableRef): Promise<ColumnMeta[]>;
  abstract ddl(t: TableRef, kind: string): Promise<string>;
  abstract objects(database?: string, schema?: string, limit?: number | null): Promise<{ name: string; schema?: string }[]>;
  abstract databases(): Promise<string[]>;
  protected abstract param(i: number): string;
  protected abstract transaction(database: string | undefined, statements: Exec[]): Promise<number>;

  qualified(t: TableRef): string {
    const owner = this.dialect === 'postgres' ? t.schema : t.database;
    return [owner, t.table]
      .filter(Boolean)
      .map((x) => this.quote(x!))
      .join('.');
  }

  selectSql(t: TableRef, o: PageOptions): string {
    let sql = `SELECT * FROM ${this.qualified(t)}`;
    if (o.where?.trim()) sql += ` WHERE ${o.where.trim()}`;
    if (o.orderBy?.trim()) sql += ` ORDER BY ${o.orderBy.trim()}`;
    return `${sql} LIMIT ${o.limit} OFFSET ${o.offset}`;
  }

  async page(t: TableRef, o: PageOptions): Promise<QueryResult> {
    const cols = await this.columns(t).catch(() => [] as ColumnMeta[]);
    const pk = cols.filter((c) => c.pk).map((c) => this.quote(c.name));
    const orderBy = o.orderBy?.trim() || (this.dialect !== 'clickhouse' && pk.length ? pk.join(', ') : undefined);
    const res = await this.run(this.selectSql(t, { ...o, orderBy }), t.database);
    const byName = new Map(cols.map((c) => [c.name, c]));
    res.columns = res.columns.map((c) => ({ ...c, ...byName.get(c.name), name: c.name }));
    return res;
  }

  async count(t: TableRef, where?: string): Promise<number> {
    let sql = `SELECT COUNT(*) FROM ${this.qualified(t)}`;
    if (where?.trim()) sql += ` WHERE ${where.trim()}`;
    const r = await this.run(sql, t.database);
    return Number(r.rows[0]?.[0] ?? 0);
  }

  async apply(t: TableRef, ch: RowChanges): Promise<number> {
    if (!this.editable || this.config.readonly) throw new Error('This connection is read-only');
    const target = this.qualified(t);
    const stmts: Exec[] = [];
    const whereOf = (key: Record<string, unknown>, params: unknown[]) =>
      Object.entries(key)
        .map(([k, v]) => {
          if (v === null) return `${this.quote(k)} IS NULL`;
          params.push(v);
          return `${this.quote(k)} = ${this.param(params.length)}`;
        })
        .join(' AND ');
    for (const d of ch.deletes) {
      const params: unknown[] = [];
      stmts.push({ sql: `DELETE FROM ${target} WHERE ${whereOf(d, params)}`, params });
    }
    for (const u of ch.updates) {
      const params: unknown[] = [];
      const sets = Object.entries(u.values).map(([k, v]) => {
        params.push(v);
        return `${this.quote(k)} = ${this.param(params.length)}`;
      });
      stmts.push({ sql: `UPDATE ${target} SET ${sets.join(', ')} WHERE ${whereOf(u.key, params)}`, params });
    }
    for (const row of ch.inserts) {
      const entries = Object.entries(row);
      const params = entries.map(([, v]) => v);
      const sql = entries.length
        ? `INSERT INTO ${target} (${entries.map(([k]) => this.quote(k)).join(', ')}) VALUES (${entries.map((_, i) => this.param(i + 1)).join(', ')})`
        : `INSERT INTO ${target} DEFAULT VALUES`;
      stmts.push({ sql, params });
    }
    return this.transaction(t.database, stmts);
  }

  literal(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') v = JSON.stringify(v);
    const s = String(v).replace(/'/g, "''");
    return this.dialect === 'postgres' ? `'${s}'` : `'${s.replace(/\\/g, '\\\\')}'`;
  }
}
