import { Pool, PoolClient, QueryArrayConfig, types as pgTypes } from 'pg';
import { ColumnMeta, DbNode, QueryResult, TableRef } from '../types';
import { formatCount, toCell } from '../util';
import { Exec, SqlDriver } from './sql';

const RAW_TYPES = new Set([1082, 1083, 1114, 1184, 1266, 1186]);

const typeParser = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (RAW_TYPES.has(oid)) return (v: string) => v;
    return pgTypes.getTypeParser(oid, format as 'text');
  },
};

export class PostgresDriver extends SqlDriver {
  readonly dialect = 'postgres' as const;
  private pools = new Map<string, Pool>();
  private typeNames = new Map<number, string>();

  private get defaultDb(): string {
    return this.config.database || 'postgres';
  }

  private async pool(db = this.defaultDb): Promise<Pool> {
    let p = this.pools.get(db);
    if (p) return p;
    const { host, port } = await this.endpoint(5432);
    p = new Pool({
      host,
      port,
      user: this.config.user,
      password: this.config.password,
      database: db,
      ssl: this.config.ssl ? { rejectUnauthorized: this.config.rejectUnauthorized ?? false } : undefined,
      max: 4,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 15000,
      types: typeParser,
      application_name: 'DBDeck',
    } as ConstructorParameters<typeof Pool>[0]);
    p.on('error', () => undefined);
    this.pools.set(db, p);
    return p;
  }

  async connect(): Promise<void> {
    const p = await this.pool();
    const r = await p.query('SELECT oid, typname FROM pg_type');
    for (const row of r.rows) this.typeNames.set(Number(row.oid), row.typname);
  }

  protected async disconnect(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
  }

  quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  protected param(i: number): string {
    return `$${i}`;
  }

  private async q<T = Record<string, unknown>>(sql: string, params: unknown[] = [], db?: string): Promise<T[]> {
    const p = await this.pool(db);
    return (await p.query(sql, params)).rows as T[];
  }

  async run(sql: string, database?: string, params?: unknown[]): Promise<QueryResult> {
    const p = await this.pool(database || this.defaultDb);
    const t = Date.now();
    const r = await p.query({ text: sql, values: params, rowMode: 'array' });
    return this.result(Array.isArray(r) ? r[r.length - 1] : r, Date.now() - t);
  }

  protected async readOnly(sql: string, database?: string): Promise<QueryResult> {
    const p = await this.pool(database || this.defaultDb);
    const c: PoolClient = await p.connect();
    try {
      await c.query('BEGIN READ ONLY');
      await c.query("SET LOCAL statement_timeout = '30s'");
      const t = Date.now();
      const r = await c.query({ text: sql, rowMode: 'array', queryMode: 'extended' } as QueryArrayConfig);
      return this.result(r, Date.now() - t);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  }

  private result(res: { fields?: { name: string; dataTypeID: number }[]; rows: unknown[]; rowCount: number | null; command?: string }, durationMs: number): QueryResult {
    const fields = res.fields ?? [];
    const isRows = fields.length > 0;
    return {
      columns: fields.map((f) => ({ name: f.name, type: this.typeNames.get(f.dataTypeID) })),
      rows: isRows ? (res.rows as unknown[][]).map((row) => row.map(toCell)) : [],
      affectedRows: isRows ? undefined : (res.rowCount ?? undefined),
      message: isRows ? undefined : `${res.command ?? 'OK'}${res.rowCount != null ? ` · ${res.rowCount} row(s)` : ''}`,
      durationMs,
    };
  }

  protected async transaction(database: string | undefined, statements: Exec[]): Promise<number> {
    const p = await this.pool(database || this.defaultDb);
    const c: PoolClient = await p.connect();
    let total = 0;
    try {
      await c.query('BEGIN');
      for (const s of statements) total += (await c.query(s.sql, s.params)).rowCount ?? 0;
      await c.query('COMMIT');
      return total;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async databases(): Promise<string[]> {
    try {
      const rows = await this.q<{ datname: string }>('SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY 1');
      return rows.map((r) => r.datname);
    } catch {
      return [this.defaultDb];
    }
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const dbs = await this.databases();
      return dbs.map((d) => this.node('database', d, { database: d, icon: 'database', tags: 'database sql', expanded: d === this.config.database }));
    }
    const db = n.database!;
    if (n.kind === 'database') {
      const sys = this.config.showSystem ? '' : "WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'";
      const rows = await this.q<{ nspname: string }>(`SELECT nspname FROM pg_namespace ${sys} ORDER BY nspname = 'public' DESC, 1`, [], db);
      return rows.map((r) => this.node('schema', r.nspname, { database: db, schema: r.nspname, icon: 'symbol-namespace', tags: 'schema sql', expanded: r.nspname === 'public' }));
    }
    if (n.kind === 'schema') {
      return [
        this.node('folder', 'Tables', { database: db, schema: n.schema, ref: 'tables', icon: 'folder-library', tags: 'folder' }),
        this.node('folder', 'Views', { database: db, schema: n.schema, ref: 'views', icon: 'folder-library', tags: 'folder' }),
        this.node('folder', 'Functions', { database: db, schema: n.schema, ref: 'functions', icon: 'folder-library', tags: 'folder' }),
      ];
    }
    if (n.kind === 'folder' && (n.ref === 'tables' || n.ref === 'views')) {
      const kinds = n.ref === 'tables' ? "('r','p','f')" : "('v','m')";
      const rows = await this.q<{ name: string; kind: string; est: number; comment: string | null }>(
        `SELECT c.relname AS name, c.relkind AS kind, c.reltuples::bigint AS est, obj_description(c.oid, 'pg_class') AS comment
         FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = $1 AND c.relkind IN ${kinds} ORDER BY 1`,
        [n.schema],
        db,
      );
      return rows.map((r) => {
        const isTable = n.ref === 'tables';
        const est = Number(r.est);
        return this.node(isTable ? 'table' : 'view', r.name, {
          database: db,
          schema: n.schema,
          table: r.name,
          icon: isTable ? 'table' : r.kind === 'm' ? 'symbol-structure' : 'eye',
          description: isTable && est >= 0 ? `~${formatCount(est)} rows` : r.kind === 'm' ? 'materialized' : undefined,
          tooltip: r.comment ?? undefined,
          tags: `${isTable ? 'table' : 'view'} sql`,
        });
      });
    }
    if (n.kind === 'folder' && n.ref === 'functions') {
      const rows = await this.q<{ name: string; args: string; oid: number; kind: string }>(
        `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, p.oid::int AS oid, p.prokind AS kind
         FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = $1 AND p.prokind IN ('f','p') ORDER BY 1`,
        [n.schema],
        db,
      );
      return rows.map((r) =>
        this.node('routine', r.name, {
          database: db,
          schema: n.schema,
          table: r.name,
          ref: String(r.oid),
          description: `(${r.args})`,
          icon: r.kind === 'p' ? 'symbol-event' : 'symbol-method',
          leaf: true,
          tags: 'routine sql',
        }),
      );
    }
    if (n.kind === 'table' || n.kind === 'view') {
      const cols = await this.columns({ database: db, schema: n.schema, table: n.table! });
      return cols.map((c) =>
        this.node('column', c.name, {
          database: db,
          schema: n.schema,
          table: n.table,
          description: `${c.type}${c.nullable ? '' : ' · not null'}`,
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
    const rows = await this.q<{ name: string; type: string; nullable: boolean; def: string | null; comment: string | null; pk: boolean }>(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
              pg_get_expr(d.adbin, d.adrelid) AS def, col_description(a.attrelid, a.attnum) AS comment,
              COALESCE((SELECT true FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)), false) AS pk
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [this.qualified(t)],
      t.database,
    );
    return rows.map((r) => ({ name: r.name, type: r.type, nullable: r.nullable, defaultValue: r.def, comment: r.comment ?? undefined, pk: r.pk }));
  }

  async objects(database?: string, schema?: string, limit: number | null = 5000): Promise<{ name: string; schema?: string }[]> {
    const rows = await this.q<{ name: string; schema: string }>(
      `SELECT c.relname AS name, ns.nspname AS schema FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE c.relkind IN ('r','p','v','m','f') AND ns.nspname NOT LIKE 'pg\\_%' AND ns.nspname <> 'information_schema'
       ${schema ? 'AND ns.nspname = $1' : ''} ORDER BY 1 ${limit === null ? '' : `LIMIT ${limit}`}`,
      schema ? [schema] : [],
      database,
    );
    return rows;
  }

  async ddl(t: TableRef, kind: string): Promise<string> {
    if (kind === 'routine') {
      const r = await this.q<{ def: string }>('SELECT pg_get_functiondef($1::oid) AS def', [Number(t.table)], t.database);
      return r[0]?.def ?? '';
    }
    const name = this.qualified(t);
    if (kind === 'view') {
      const r = await this.q<{ def: string; kind: string }>(
        `SELECT pg_get_viewdef($1::regclass, true) AS def, relkind AS kind FROM pg_class WHERE oid = $1::regclass`,
        [name],
        t.database,
      );
      const mat = r[0]?.kind === 'm' ? 'MATERIALIZED VIEW' : 'OR REPLACE VIEW';
      return `CREATE ${mat} ${name} AS\n${r[0]?.def ?? ''}`;
    }
    const cols = await this.columns(t);
    const cons = await this.q<{ name: string; def: string }>(
      `SELECT conname AS name, pg_get_constraintdef(oid, true) AS def FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY contype DESC, conname`,
      [name],
      t.database,
    );
    const idx = await this.q<{ def: string }>(
      `SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i WHERE i.indrelid = $1::regclass AND NOT i.indisprimary
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)`,
      [name],
      t.database,
    );
    const lines = cols.map((c) => `  ${this.quote(c.name)} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.defaultValue ? ` DEFAULT ${c.defaultValue}` : ''}`);
    for (const c of cons) lines.push(`  CONSTRAINT ${this.quote(c.name)} ${c.def}`);
    let out = `CREATE TABLE ${name} (\n${lines.join(',\n')}\n);\n`;
    for (const i of idx) out += `\n${i.def};`;
    for (const c of cols.filter((c) => c.comment)) out += `\nCOMMENT ON COLUMN ${name}.${this.quote(c.name)} IS ${this.literal(c.comment)};`;
    return out;
  }
}
