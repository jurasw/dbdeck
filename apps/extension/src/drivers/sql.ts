import { ColumnMeta, QueryResult, TableRef, ValueSearchPage } from '../types';
import { splitSql, SqlDialect, stripComments } from '../sqlSplit';
import { BaseDriver } from './base';

export interface PageOptions {
  limit: number;
  offset: number;
  where?: string;
  orderBy?: string;
  search?: string;
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

const COUNT_SLOTS = 2;

export abstract class SqlDriver extends BaseDriver {
  abstract readonly dialect: SqlDialect;
  readonly editable: boolean = true;
  private counts?: { running: number; waiting: (() => void)[] };

  abstract run(sql: string, database?: string, params?: unknown[]): Promise<QueryResult>;
  protected abstract readOnly(sql: string, database?: string): Promise<QueryResult>;
  abstract quote(name: string): string;
  abstract columns(t: TableRef): Promise<ColumnMeta[]>;
  abstract ddl(t: TableRef, kind: string): Promise<string>;
  abstract objects(database?: string, schema?: string, limit?: number | null): Promise<{ name: string; schema?: string }[]>;
  abstract databases(): Promise<string[]>;
  protected abstract param(i: number): string;
  protected abstract transaction(database: string | undefined, statements: Exec[]): Promise<number>;

  async runReadOnly(sql: string, database?: string): Promise<QueryResult> {
    const statements = splitSql(sql, this.dialect);
    if (statements.length !== 1) throw new Error('Run exactly one SQL statement.');
    const text = stripComments(statements[0].text).trim();
    if (!/^(select|with|show|describe|desc|explain|table|values)\b/i.test(text) || /\binto\s+(outfile|dumpfile)\b/i.test(text))
      throw new Error('Only read-only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN statements can run here.');
    return this.readOnly(statements[0].text, database);
  }

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
    const orderBy = o.orderBy?.trim() || ((this.dialect === 'postgres' || this.dialect === 'mysql') && pk.length ? pk.join(', ') : undefined);
    const res = await this.run(this.selectSql(t, { ...o, where: this.searchWhere(cols, o.where, o.search), orderBy }), t.database);
    const byName = new Map(cols.map((c) => [c.name, c]));
    res.columns = res.columns.map((c) => ({ ...c, ...byName.get(c.name), name: c.name }));
    return res;
  }

  async count(t: TableRef, where?: string, search?: string): Promise<number> {
    const counts = (this.counts ??= { running: 0, waiting: [] });
    if (counts.running >= COUNT_SLOTS) await new Promise<void>((resolve) => counts.waiting.push(resolve));
    else counts.running++;
    try {
      if (search?.trim()) where = this.searchWhere(await this.columns(t), where, search);
      let sql = `SELECT COUNT(*) FROM ${this.qualified(t)}`;
      if (where?.trim()) sql += ` WHERE ${where.trim()}`;
      const r = await this.run(sql, t.database);
      return Number(r.rows[0]?.[0] ?? 0);
    } finally {
      const next = counts.waiting.pop();
      if (next) next();
      else counts.running--;
    }
  }

  searchWhere(cols: ColumnMeta[], where?: string, search?: string): string | undefined {
    const text = search?.trim();
    if (!text) return where;
    if (!cols.length) throw new Error('Cannot read the table columns to search.');
    const match = cols.map((c) => this.contains(this.quote(c.name), text)).join(' OR ');
    return where?.trim() ? `(${where.trim()}) AND (${match})` : match;
  }

  private contains(column: string, text: string): string {
    if (this.dialect === 'clickhouse') return `positionCaseInsensitiveUTF8(toString(${column}), ${this.literal(text)}) > 0`;
    if (this.dialect === 'bigquery') return `CONTAINS_SUBSTR(${column}, ${this.literal(text)})`;
    if (this.dialect === 'snowflake') return `CONTAINS(LOWER(TO_VARCHAR(${column})), LOWER(${this.literal(text)}))`;
    return this.dialect === 'postgres'
      ? `strpos(lower(${column}::text), lower(${this.literal(text)})) > 0`
      : `LOCATE(LOWER(${this.literal(text)}), LOWER(CAST(${column} AS CHAR))) > 0`;
  }

  private text(column: string): string {
    switch (this.dialect) {
      case 'postgres':
        return `${column}::text`;
      case 'mysql':
        return `CAST(${column} AS CHAR)`;
      case 'bigquery':
        return `FORMAT('%t', ${column})`;
      case 'snowflake':
        return `TO_VARCHAR(${column})`;
      default:
        return `toString(${column})`;
    }
  }

  async searchValues(t: TableRef, search: string, cancelled: () => boolean): Promise<ValueSearchPage> {
    if (!search.trim() || cancelled()) return { matches: [], limited: false };
    const columns = await this.columns(t);
    if (cancelled()) return { matches: [], limited: false };
    const where = this.searchWhere(columns, undefined, search);
    // Return the database's text representation and match decision, including JSON,
    // dates and numbers. This keeps previews consistent with the data viewer.
    const projection = columns.map((c) => {
      const column = this.quote(c.name);
      return `CASE WHEN ${this.contains(column, search.trim())} THEN ${this.text(column)} ELSE NULL END AS ${column}`;
    });
    const result = await this.readOnly(`SELECT ${projection.join(', ')} FROM ${this.qualified(t)} WHERE ${where} LIMIT 21`, t.database);
    if (cancelled()) return { matches: [], limited: false };
    return {
      matches: result.rows.slice(0, 20).flatMap((row) => row.flatMap((value, i) => (value == null ? [] : [{ column: columns[i].name, value: String(value) }]))),
      limited: result.rows.length > 20,
    };
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
    if (this.dialect === 'bigquery') return `'${String(v).replace(/[\\'\n\r]/g, (c) => ({ '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r' })[c]!)}'`;
    const s = String(v).replace(/'/g, "''");
    return this.dialect === 'postgres' ? `'${s}'` : `'${s.replace(/\\/g, '\\\\')}'`;
  }
}
