import { ColumnMeta, DbNode, QueryResult, TableRef } from '../types';
import { formatCount, httpRequest } from '../util';
import { Exec, SqlDriver } from './sql';

const SYSTEM_DBS = new Set(['system', 'information_schema', 'INFORMATION_SCHEMA']);

interface JsonCompact {
  meta: { name: string; type: string }[];
  data: unknown[][];
  rows: number;
  statistics?: { elapsed: number; rows_read: number; bytes_read: number };
}

function extractError(body: string): string | undefined {
  try {
    return (JSON.parse(body) as { exception?: string })?.exception?.trim();
  } catch {
    const m = /"exception":\s*"((?:\\.|[^"\\])*)"/.exec(body);
    return m ? (JSON.parse(`"${m[1]}"`) as string).trim() : undefined;
  }
}

export class ClickHouseDriver extends SqlDriver {
  readonly dialect = 'clickhouse' as const;
  readonly editable = false;
  private base = '';

  async connect(): Promise<void> {
    const { host, port } = await this.endpoint(8123);
    const proto = this.config.ssl ? 'https' : 'http';
    this.base = `${proto}://${host.includes(':') ? `[${host}]` : host}:${port}`;
    await this.exec('SELECT 1');
  }

  protected async disconnect(): Promise<void> {
    this.base = '';
  }

  quote(name: string): string {
    return `\`${name.replace(/`/g, '\\`')}\``;
  }

  protected param(): string {
    throw new Error('ClickHouse does not support parameters');
  }

  protected async transaction(_db: string | undefined, _s: Exec[]): Promise<number> {
    throw new Error('Editing is not supported for ClickHouse tables');
  }

  private async exec(sql: string, database?: string): Promise<string> {
    const qs = new URLSearchParams({ default_format: 'JSONCompact', output_format_json_quote_64bit_integers: '1' });
    const db = database || this.config.database;
    if (db) qs.set('database', db);
    const headers: Record<string, string> = { 'content-type': 'text/plain; charset=utf-8' };
    if (this.config.user) headers['X-ClickHouse-User'] = this.config.user;
    if (this.config.password) headers['X-ClickHouse-Key'] = this.config.password;
    const r = await httpRequest({
      method: 'POST',
      url: `${this.base}/?${qs}`,
      headers,
      body: sql,
      rejectUnauthorized: this.config.rejectUnauthorized ?? false,
    });
    if (r.status !== 200) throw new Error(extractError(r.body) || r.body.trim() || `HTTP ${r.status}`);
    if (r.body.includes('"exception"')) {
      const mid = extractError(r.body);
      if (mid) throw new Error(mid);
    }
    return r.body;
  }

  private async rows<T>(sql: string, database?: string): Promise<T[]> {
    const body = await this.exec(sql, database);
    const j = JSON.parse(body) as JsonCompact;
    return j.data.map((row) => Object.fromEntries(j.meta.map((m, i) => [m.name, row[i]])) as T);
  }

  async run(sql: string, database?: string): Promise<QueryResult> {
    const t = Date.now();
    const body = await this.exec(sql, database);
    const durationMs = Date.now() - t;
    if (!body.trim()) return { columns: [], rows: [], message: 'OK', durationMs };
    try {
      const j = JSON.parse(body) as JsonCompact;
      return {
        columns: j.meta.map((m) => ({ name: m.name, type: m.type })),
        rows: j.data,
        durationMs,
        message: j.statistics ? `${formatCount(j.statistics.rows_read)} rows read in ${(j.statistics.elapsed * 1000).toFixed(0)} ms` : undefined,
      };
    } catch {
      const lines = body.replace(/\n$/, '').split('\n');
      return { columns: [{ name: 'result' }], rows: lines.map((l) => [l]), durationMs };
    }
  }

  private lit(s: string): string {
    return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }

  async databases(): Promise<string[]> {
    const rows = await this.rows<{ name: string }>('SELECT name FROM system.databases ORDER BY name');
    return rows.map((r) => r.name).filter((d) => this.config.showSystem || !SYSTEM_DBS.has(d));
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const dbs = await this.databases();
      return dbs.map((d) => this.node('database', d, { database: d, icon: 'database', tags: 'database sql', expanded: d === this.config.database }));
    }
    if (n.kind === 'database') {
      const rows = await this.rows<{ name: string; engine: string; total_rows: string | null; comment: string }>(
        `SELECT name, engine, total_rows, comment FROM system.tables WHERE database = ${this.lit(n.database!)} ORDER BY name`,
      );
      return rows.map((r) => {
        const isView = r.engine.endsWith('View');
        return this.node(isView ? 'view' : 'table', r.name, {
          database: n.database,
          table: r.name,
          icon: isView ? 'eye' : 'table',
          description: r.total_rows != null ? `${formatCount(Number(r.total_rows))} rows · ${r.engine}` : r.engine,
          tooltip: r.comment || undefined,
          tags: `${isView ? 'view' : 'table'} sql`,
        });
      });
    }
    if (n.kind === 'table' || n.kind === 'view') {
      const cols = await this.columns({ database: n.database, table: n.table! });
      return cols.map((c) =>
        this.node('column', c.name, {
          database: n.database,
          table: n.table,
          description: c.type,
          tooltip: c.comment || undefined,
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
    const rows = await this.rows<{ name: string; type: string; is_in_primary_key: number; default_expression: string; comment: string }>(
      `SELECT name, type, is_in_primary_key, default_expression, comment FROM system.columns
       WHERE database = ${this.lit(t.database ?? this.config.database ?? 'default')} AND table = ${this.lit(t.table)} ORDER BY position`,
    );
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      pk: Number(r.is_in_primary_key) === 1,
      nullable: r.type.startsWith('Nullable'),
      defaultValue: r.default_expression || null,
      comment: r.comment || undefined,
    }));
  }

  async objects(database?: string): Promise<{ name: string }[]> {
    return this.rows<{ name: string }>(`SELECT name FROM system.tables WHERE database = ${this.lit(database ?? this.config.database ?? 'default')} ORDER BY name LIMIT 5000`);
  }

  async ddl(t: TableRef): Promise<string> {
    const r = await this.rows<{ statement: string }>(`SHOW CREATE TABLE ${this.qualified(t)}`);
    return (r[0]?.statement ?? '') + ';';
  }
}
