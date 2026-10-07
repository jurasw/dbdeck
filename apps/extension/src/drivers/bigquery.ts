import { ColumnMeta, ConnectionConfig, DbNode, QueryResult, TableRef } from '../types';
import { formatBytes, formatCount } from '../util';
import { Exec, PageOptions, SqlDriver } from './sql';

export const BIGQUERY_SCOPE = 'https://www.googleapis.com/auth/bigquery';
const MAX_ROWS = 10000;
const READ_ONLY_MAX_BYTES = 10 * 1024 ** 3;

export interface BigQueryCredentials {
  token(): Promise<string>;
  projectId(): string | undefined;
}

interface Field {
  name: string;
  type: string;
  mode?: 'NULLABLE' | 'REQUIRED' | 'REPEATED';
  fields?: Field[];
  description?: string;
  defaultValueExpression?: string;
}

interface Cell {
  v: unknown;
}

interface Row {
  f: Cell[];
}

interface QueryResponse {
  jobComplete: boolean;
  jobReference: { jobId: string; location?: string };
  schema?: { fields: Field[] };
  rows?: Row[];
  totalRows?: string;
  pageToken?: string;
  numDmlAffectedRows?: string;
  totalBytesProcessed?: string;
  cacheHit?: boolean;
}

interface TableMeta {
  type: string;
  numRows?: string;
  description?: string;
  schema?: { fields: Field[] };
  tableConstraints?: { primaryKey?: { columns: string[] } };
  view?: { query: string };
  materializedView?: { query: string };
}

function fieldType(f: Field): string {
  const base = f.type === 'RECORD' || f.type === 'STRUCT' ? `STRUCT<${(f.fields ?? []).map((x) => `${x.name} ${fieldType(x)}`).join(', ')}>` : f.type;
  return f.mode === 'REPEATED' ? `ARRAY<${base}>` : base;
}

function scalar(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'INTEGER':
    case 'INT64': {
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : String(v);
    }
    case 'FLOAT':
    case 'FLOAT64':
      return Number(v);
    case 'BOOLEAN':
    case 'BOOL':
      return v === 'true' || v === true;
    case 'TIMESTAMP': {
      const ms = Number(BigInt(String(v)) / 1000n);
      return new Date(ms).toISOString();
    }
    case 'JSON':
      try {
        return JSON.parse(String(v));
      } catch {
        return v;
      }
    default:
      return v;
  }
}

function decodeValue(f: Field, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  const one = (x: unknown): unknown =>
    f.type === 'RECORD' || f.type === 'STRUCT' ? Object.fromEntries((f.fields ?? []).map((sub, i) => [sub.name, decodeValue(sub, (x as Row).f[i].v)])) : scalar(f.type, x);
  return f.mode === 'REPEATED' ? (v as Cell[]).map((c) => one(c.v)) : one(v);
}

function apiError(text: string): string | undefined {
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message;
  } catch {
    return undefined;
  }
}

function decodeRows(fields: Field[], rows: Row[] = []): unknown[][] {
  return rows.map((r) => r.f.map((c, i) => decodeValue(fields[i], c.v)));
}

export class BigQueryDriver extends SqlDriver {
  readonly dialect = 'bigquery' as const;
  readonly editable = false;
  private project = '';

  constructor(
    config: ConnectionConfig,
    private readonly credentials: BigQueryCredentials,
    private readonly base = 'https://bigquery.googleapis.com/bigquery/v2',
  ) {
    super(config);
  }

  async connect(): Promise<void> {
    this.project = this.config.project?.trim() || this.credentials.projectId() || '';
    if (!this.project) throw new Error('Enter the Google Cloud project ID.');
    await this.call(`/datasets?maxResults=1`);
  }

  protected async disconnect(): Promise<void> {
    this.project = '';
  }

  private async call<T>(url: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.base}/projects/${encodeURIComponent(this.project)}${url}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${await this.credentials.token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120000),
    });
    const text = await r.text();
    if (!r.ok) {
      const message = apiError(text) ?? text.trim();
      if (r.status === 401) throw new Error(`Google credentials were rejected. ${message}`);
      throw new Error(message || `HTTP ${r.status}`);
    }
    return JSON.parse(text) as T;
  }

  quote(name: string): string {
    return `\`${name.replace(/[\\`]/g, '\\$&')}\``;
  }

  protected param(): string {
    throw new Error('BigQuery parameters are not supported here');
  }

  protected async transaction(_db: string | undefined, _s: Exec[]): Promise<number> {
    throw new Error('Editing is not supported for BigQuery tables');
  }

  private async query(sql: string, database?: string, readOnly = false): Promise<QueryResult> {
    const t = Date.now();
    const dataset = database || this.config.database;
    let res = await this.call<QueryResponse>('/queries', {
      query: sql,
      useLegacySql: false,
      maxResults: MAX_ROWS,
      timeoutMs: 20000,
      location: this.config.region || undefined,
      defaultDataset: dataset ? { projectId: this.project, datasetId: dataset } : undefined,
      maximumBytesBilled: readOnly ? String(READ_ONLY_MAX_BYTES) : undefined,
      jobTimeoutMs: readOnly ? 30000 : undefined,
      formatOptions: { useInt64Timestamp: true },
    });
    const job = res.jobReference;
    const results = (extra: Record<string, string>) =>
      this.call<QueryResponse>(
        `/queries/${encodeURIComponent(job.jobId)}?${new URLSearchParams({ ...(job.location ? { location: job.location } : {}), 'formatOptions.useInt64Timestamp': 'true', ...extra })}`,
      );
    while (!res.jobComplete) res = await results({ timeoutMs: '20000', maxResults: String(MAX_ROWS) });
    const fields = res.schema?.fields ?? [];
    const rows = decodeRows(fields, res.rows);
    let token = res.pageToken;
    while (token && rows.length < MAX_ROWS) {
      const next = await results({ pageToken: token, maxResults: String(MAX_ROWS - rows.length) });
      rows.push(...decodeRows(fields, next.rows));
      token = next.pageToken;
    }
    const durationMs = Date.now() - t;
    const processed = res.cacheHit ? 'cached' : res.totalBytesProcessed ? `${formatBytes(Number(res.totalBytesProcessed))} processed` : undefined;
    if (res.numDmlAffectedRows !== undefined || !fields.length) {
      const affected = res.numDmlAffectedRows !== undefined ? Number(res.numDmlAffectedRows) : undefined;
      return {
        columns: [],
        rows: [],
        affectedRows: affected,
        message: [affected !== undefined ? `${formatCount(affected)} row(s)` : 'OK', processed].filter(Boolean).join(' · '),
        durationMs,
      };
    }
    const total = Number(res.totalRows ?? rows.length);
    return {
      columns: fields.map((f) => ({ name: f.name, type: fieldType(f) })),
      rows,
      durationMs,
      truncated: total > rows.length,
      message: [total > rows.length ? `First ${formatCount(rows.length)} of ${formatCount(total)} rows` : undefined, processed].filter(Boolean).join(' · ') || undefined,
    };
  }

  run(sql: string, database?: string): Promise<QueryResult> {
    return this.query(sql, database);
  }

  protected readOnly(sql: string, database?: string): Promise<QueryResult> {
    return this.query(sql, database, true);
  }

  private tablePath(t: TableRef): string {
    return `/datasets/${encodeURIComponent(t.database ?? this.config.database ?? '')}/tables/${encodeURIComponent(t.table)}`;
  }

  private table(t: TableRef): Promise<TableMeta> {
    return this.call<TableMeta>(this.tablePath(t));
  }

  async page(t: TableRef, o: PageOptions): Promise<QueryResult> {
    if (o.where?.trim() || o.search?.trim() || o.orderBy?.trim()) return super.page(t, o);
    const meta = await this.table(t);
    if (meta.type !== 'TABLE') return super.page(t, o);
    const time = Date.now();
    const fields = meta.schema?.fields ?? [];
    const data = await this.call<{ rows?: Row[] }>(
      `${this.tablePath(t)}/data?${new URLSearchParams({ startIndex: String(o.offset), maxResults: String(o.limit), 'formatOptions.useInt64Timestamp': 'true' })}`,
    );
    const pk = new Set(meta.tableConstraints?.primaryKey?.columns ?? []);
    return {
      columns: fields.map((f) => ({ name: f.name, type: fieldType(f), nullable: f.mode !== 'REQUIRED', pk: pk.has(f.name), comment: f.description })),
      rows: decodeRows(fields, data.rows),
      durationMs: Date.now() - time,
    };
  }

  async count(t: TableRef, where?: string, search?: string): Promise<number> {
    if (!where?.trim() && !search?.trim()) {
      const meta = await this.table(t);
      if (meta.type === 'TABLE' && meta.numRows !== undefined) return Number(meta.numRows);
    }
    return super.count(t, where, search);
  }

  async databases(): Promise<string[]> {
    const out: string[] = [];
    let token = '';
    do {
      const r = await this.call<{ datasets?: { datasetReference: { datasetId: string } }[]; nextPageToken?: string }>(
        `/datasets?${new URLSearchParams({ maxResults: '1000', ...(this.config.showSystem ? { all: 'true' } : {}), ...(token ? { pageToken: token } : {}) })}`,
      );
      out.push(...(r.datasets ?? []).map((d) => d.datasetReference.datasetId));
      token = r.nextPageToken ?? '';
    } while (token);
    return out.sort((a, b) => a.localeCompare(b));
  }

  private async tables(dataset: string, limit: number | null = null): Promise<{ name: string; type: string }[]> {
    const out: { name: string; type: string }[] = [];
    let token = '';
    do {
      const r = await this.call<{ tables?: { tableReference: { tableId: string }; type: string }[]; nextPageToken?: string }>(
        `/datasets/${encodeURIComponent(dataset)}/tables?${new URLSearchParams({ maxResults: '1000', ...(token ? { pageToken: token } : {}) })}`,
      );
      out.push(...(r.tables ?? []).map((x) => ({ name: x.tableReference.tableId, type: x.type })));
      token = r.nextPageToken ?? '';
    } while (token && (limit === null || out.length < limit));
    return (limit === null ? out : out.slice(0, limit)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const datasets = await this.databases();
      return datasets.map((d) => this.node('database', d, { database: d, icon: 'database', tags: 'database sql', expanded: d === this.config.database }));
    }
    if (n.kind === 'database') {
      const tables = await this.tables(n.database!);
      return tables.map((t) => {
        const isView = t.type === 'VIEW' || t.type === 'MATERIALIZED_VIEW';
        return this.node(isView ? 'view' : 'table', t.name, {
          database: n.database,
          table: t.name,
          icon: isView ? (t.type === 'VIEW' ? 'eye' : 'symbol-structure') : 'table',
          description: t.type === 'TABLE' || t.type === 'VIEW' ? undefined : t.type.toLowerCase().replace('_', ' '),
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
          description: `${c.type}${c.nullable ? '' : ' · required'}`,
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
    const meta = await this.table(t);
    const pk = new Set(meta.tableConstraints?.primaryKey?.columns ?? []);
    return (meta.schema?.fields ?? []).map((f) => ({
      name: f.name,
      type: fieldType(f),
      nullable: f.mode !== 'REQUIRED',
      pk: pk.has(f.name),
      defaultValue: f.defaultValueExpression ?? null,
      comment: f.description,
    }));
  }

  async objects(database?: string, _schema?: string, limit: number | null = 5000): Promise<{ name: string }[]> {
    return (await this.tables(database ?? this.config.database ?? '', limit)).map((t) => ({ name: t.name }));
  }

  async ddl(t: TableRef): Promise<string> {
    const dataset = t.database ?? this.config.database ?? '';
    const r = await this.query(`SELECT ddl FROM ${this.quote(this.project)}.${this.quote(dataset)}.INFORMATION_SCHEMA.TABLES WHERE table_name = ${this.literal(t.table)}`, dataset);
    return String(r.rows[0]?.[0] ?? '');
  }
}
