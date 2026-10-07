import { createHash, createPrivateKey, createPublicKey, KeyObject, randomUUID, sign } from 'node:crypto';
import * as fs from 'node:fs';
import { ColumnMeta, ConnectionConfig, DbNode, QueryResult, TableRef } from '../types';
import { expandHome, formatCount } from '../util';
import { Exec, SqlDriver } from './sql';

const MAX_ROWS = 10000;
const SYSTEM_SCHEMAS = new Set(['INFORMATION_SCHEMA']);

interface RowType {
  name: string;
  type: string;
  precision?: number;
  scale?: number;
  length?: number;
  nullable?: boolean;
}

interface StatementResponse {
  statementHandle: string;
  statementStatusUrl?: string;
  message?: string;
  code?: string;
  resultSetMetaData?: { numRows: number; rowType: RowType[]; partitionInfo?: { rowCount: number }[] };
  data?: (string | null)[][];
  stats?: { numRowsInserted?: number; numRowsUpdated?: number; numRowsDeleted?: number };
}

export function snowflakeAccount(host: string | undefined): string {
  const account = (host ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.snowflakecomputing\.com$/i, '');
  if (!account) throw new Error('Enter the Snowflake account identifier, for example myorg-myaccount.');
  return account;
}

function typeName(t: RowType): string {
  switch (t.type) {
    case 'fixed':
      return t.scale ? `NUMBER(${t.precision},${t.scale})` : 'NUMBER';
    case 'real':
      return 'FLOAT';
    case 'text':
      return 'VARCHAR';
    default:
      return t.type.toUpperCase();
  }
}

function seconds(v: string, utc: boolean): string {
  const [sec, frac = ''] = v.split('.');
  const iso = new Date(Number(sec) * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const f = frac.replace(/0+$/, '');
  return `${iso}${f ? `.${f}` : ''}${utc ? ' UTC' : ''}`;
}

export function snowflakeValue(t: RowType, v: string | null): unknown {
  if (v === null) return null;
  switch (t.type) {
    case 'fixed': {
      const n = Number(v);
      return (t.scale ?? 0) === 0 && !Number.isSafeInteger(n) ? v : n;
    }
    case 'real':
      return Number(v);
    case 'boolean':
      return v === 'true' || v === '1';
    case 'date':
      return new Date(Number(v) * 86400000).toISOString().slice(0, 10);
    case 'time':
      return seconds(v, false).slice(11);
    case 'timestamp_ntz':
      return seconds(v, false);
    case 'timestamp_ltz':
      return seconds(v, true);
    case 'timestamp_tz': {
      const [value, offset] = v.split(' ');
      const [sec, frac] = value.split('.');
      const minutes = Number(offset) - 1440;
      const abs = Math.abs(minutes);
      const zone = `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
      return `${seconds(`${Number(sec) + minutes * 60}${frac ? `.${frac}` : ''}`, false)} ${zone}`;
    }
    case 'variant':
    case 'object':
    case 'array':
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    default:
      return v;
  }
}

export class SnowflakeDriver extends SqlDriver {
  readonly dialect = 'snowflake' as const;
  readonly editable = false;
  private key?: KeyObject;
  private jwt?: { token: string; expiresAt: number };

  constructor(
    config: ConnectionConfig,
    private readonly base = `https://${snowflakeAccount(config.host)}.snowflakecomputing.com`,
  ) {
    super(config);
  }

  async connect(): Promise<void> {
    if (!this.config.user) throw new Error('Enter the Snowflake user name.');
    if (this.config.authMethod === 'keyPair') {
      if (!this.config.keyFile) throw new Error('Choose the private key file.');
      this.key = createPrivateKey({ key: fs.readFileSync(expandHome(this.config.keyFile), 'utf8'), passphrase: this.config.password || undefined });
    } else if (!this.config.password) throw new Error('Enter a programmatic access token.');
    await this.statement('SHOW TERSE DATABASES LIMIT 1');
  }

  protected async disconnect(): Promise<void> {
    this.key = undefined;
    this.jwt = undefined;
  }

  private auth(): Record<string, string> {
    if (!this.key) return { Authorization: `Bearer ${this.config.password}`, 'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN' };
    if (!this.jwt || this.jwt.expiresAt < Date.now() + 60000) {
      const account = snowflakeAccount(this.config.host).split('.')[0].toUpperCase();
      const user = this.config.user!.toUpperCase();
      const fingerprint = createHash('sha256')
        .update(createPublicKey(this.key).export({ type: 'spki', format: 'der' }))
        .digest('base64');
      const now = Math.floor(Date.now() / 1000);
      const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: `${account}.${user}.SHA256:${fingerprint}`, sub: `${account}.${user}`, iat: now, exp: now + 3600 })}`;
      this.jwt = { token: `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), this.key).toString('base64url')}`, expiresAt: (now + 3600) * 1000 };
    }
    return { Authorization: `Bearer ${this.jwt.token}`, 'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT' };
  }

  private async request(path: string, body?: unknown): Promise<{ status: number; body: StatementResponse }> {
    const r = await fetch(this.base + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...this.auth(), Accept: 'application/json', 'User-Agent': 'DBDeck', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120000),
    });
    const text = await r.text();
    let json: StatementResponse;
    try {
      json = JSON.parse(text) as StatementResponse;
    } catch {
      throw new Error(text.trim() || `HTTP ${r.status}`);
    }
    if (r.status === 401) throw new Error(`Snowflake rejected the credentials. ${json.message ?? ''}`.trim());
    if (r.status >= 400) throw new Error(json.message || `HTTP ${r.status}`);
    return { status: r.status, body: json };
  }

  private async statement(sql: string, database?: string, timeout = 0): Promise<{ res: StatementResponse; rows: (string | null)[][] }> {
    const db = database || this.config.database;
    let { status, body } = await this.request(`/api/v2/statements?requestId=${randomUUID()}`, {
      statement: sql,
      timeout,
      database: db || undefined,
      warehouse: this.config.warehouse || undefined,
      role: this.config.role || undefined,
    });
    const handle = `/api/v2/statements/${encodeURIComponent(body.statementHandle)}`;
    while (status === 202) {
      await new Promise((r) => setTimeout(r, 500));
      ({ status, body } = await this.request(handle));
    }
    const rows = [...(body.data ?? [])];
    const parts = body.resultSetMetaData?.partitionInfo ?? [];
    for (let i = 1; i < parts.length && rows.length < MAX_ROWS; i++) rows.push(...((await this.request(`${handle}?partition=${i}`)).body.data ?? []));
    return { res: body, rows: rows.slice(0, MAX_ROWS) };
  }

  private async records(sql: string, database?: string): Promise<Record<string, string | null>[]> {
    const { res, rows } = await this.statement(sql, database);
    const names = (res.resultSetMetaData?.rowType ?? []).map((t) => t.name.toLowerCase());
    return rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])));
  }

  private async execute(sql: string, database?: string, timeout = 0): Promise<QueryResult> {
    const t = Date.now();
    const { res, rows } = await this.statement(sql, database, timeout);
    const durationMs = Date.now() - t;
    const types = res.resultSetMetaData?.rowType ?? [];
    const total = res.resultSetMetaData?.numRows ?? rows.length;
    const dml = res.stats ? (res.stats.numRowsInserted ?? 0) + (res.stats.numRowsUpdated ?? 0) + (res.stats.numRowsDeleted ?? 0) : undefined;
    if (dml !== undefined) return { columns: [], rows: [], affectedRows: dml, message: `${formatCount(dml)} row(s)`, durationMs };
    return {
      columns: types.map((c) => ({ name: c.name, type: typeName(c), nullable: c.nullable })),
      rows: rows.map((r) => r.map((v, i) => snowflakeValue(types[i], v))),
      durationMs,
      truncated: total > rows.length,
      message: total > rows.length ? `First ${formatCount(rows.length)} of ${formatCount(total)} rows` : undefined,
    };
  }

  run(sql: string, database?: string): Promise<QueryResult> {
    return this.execute(sql, database);
  }

  protected readOnly(sql: string, database?: string): Promise<QueryResult> {
    return this.execute(sql, database, 30);
  }

  quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  qualified(t: TableRef): string {
    return [t.database, t.schema, t.table]
      .filter(Boolean)
      .map((x) => this.quote(x!))
      .join('.');
  }

  protected param(): string {
    throw new Error('Snowflake parameters are not supported here');
  }

  protected async transaction(_db: string | undefined, _s: Exec[]): Promise<number> {
    throw new Error('Editing is not supported for Snowflake tables');
  }

  async databases(): Promise<string[]> {
    const rows = await this.records('SHOW TERSE DATABASES');
    return rows.map((r) => r.name!).filter((d) => this.config.showSystem || d !== 'SNOWFLAKE');
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const dbs = await this.databases();
      return dbs.map((d) => this.node('database', d, { database: d, icon: 'database', tags: 'database sql', expanded: d === this.config.database }));
    }
    const db = n.database!;
    if (n.kind === 'database') {
      const rows = await this.records(`SHOW TERSE SCHEMAS IN DATABASE ${this.quote(db)}`);
      return rows
        .map((r) => r.name!)
        .filter((s) => this.config.showSystem || !SYSTEM_SCHEMAS.has(s))
        .map((s) => this.node('schema', s, { database: db, schema: s, icon: 'symbol-namespace', tags: 'schema sql', expanded: s === 'PUBLIC' }));
    }
    if (n.kind === 'schema') {
      return [
        this.node('folder', 'Tables', { database: db, schema: n.schema, ref: 'tables', icon: 'folder-library', tags: 'folder' }),
        this.node('folder', 'Views', { database: db, schema: n.schema, ref: 'views', icon: 'folder-library', tags: 'folder' }),
      ];
    }
    if (n.kind === 'folder' && n.ref === 'tables') {
      const rows = await this.records(`SHOW TABLES IN SCHEMA ${this.qualified({ database: db, table: n.schema! })}`);
      return rows.map((r) =>
        this.node('table', r.name!, {
          database: db,
          schema: n.schema,
          table: r.name!,
          icon: 'table',
          description: r.rows != null ? `${formatCount(Number(r.rows))} rows` : undefined,
          tooltip: r.comment || undefined,
          tags: 'table sql',
        }),
      );
    }
    if (n.kind === 'folder' && n.ref === 'views') {
      const rows = await this.records(`SHOW VIEWS IN SCHEMA ${this.qualified({ database: db, table: n.schema! })}`);
      return rows.map((r) =>
        this.node('view', r.name!, {
          database: db,
          schema: n.schema,
          table: r.name!,
          icon: r.is_materialized === 'true' ? 'symbol-structure' : 'eye',
          description: r.is_materialized === 'true' ? 'materialized' : undefined,
          tooltip: r.comment || undefined,
          tags: 'view sql',
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
    const rows = await this.records(`DESCRIBE TABLE ${this.qualified(t)}`, t.database);
    return rows.map((r) => ({
      name: r.name!,
      type: r.type ?? undefined,
      nullable: r['null?'] !== 'N',
      pk: r['primary key'] === 'Y',
      defaultValue: r.default,
      comment: r.comment || undefined,
    }));
  }

  async objects(database?: string, schema?: string, limit: number | null = 5000): Promise<{ name: string; schema?: string }[]> {
    const db = database ?? this.config.database ?? '';
    const scope = schema ? `SCHEMA ${this.qualified({ database: db, table: schema })}` : `DATABASE ${this.quote(db)}`;
    const rows = await this.records(`SHOW TERSE OBJECTS IN ${scope}${limit === null ? '' : ` LIMIT ${limit}`}`, db);
    return rows.filter((r) => !SYSTEM_SCHEMAS.has(r.schema_name ?? '')).map((r) => ({ name: r.name!, schema: r.schema_name ?? undefined }));
  }

  async ddl(t: TableRef, kind: string): Promise<string> {
    const r = await this.records(`SELECT GET_DDL(${this.literal(kind === 'view' ? 'VIEW' : 'TABLE')}, ${this.literal(this.qualified(t))}) AS ddl`, t.database);
    return r[0]?.ddl ?? '';
  }
}
