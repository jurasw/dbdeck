import { splitSql, stripComments } from '../sqlSplit';
import { ConnectionConfig, QueryResult, TableRef } from '../types';
import { httpRequest, toCell } from '../util';
import { Exec } from './sql';
import { SqliteSchemaDriver } from './sqlite-schema';

interface D1Result {
  success?: boolean;
  error?: string;
  meta?: { changes?: number };
  results?: { columns?: string[]; rows?: unknown[][] };
}

export class D1Driver extends SqliteSchemaDriver {
  // The REST API does not document rollback guarantees for batch requests.
  override readonly editable = false;

  constructor(
    config: ConnectionConfig,
    private readonly apiBase = 'https://api.cloudflare.com/client/v4',
  ) {
    super(config);
  }

  async connect(): Promise<void> {
    if (!this.config.accountId?.trim()) throw new Error('Enter the Cloudflare Account ID.');
    if (!this.config.database?.trim()) throw new Error('Enter the D1 Database ID.');
    if (!this.config.apiKey?.trim()) throw new Error('Enter a Cloudflare API token with D1 Read or D1 Write permission.');
    await this.run('SELECT 1');
  }

  protected async disconnect(): Promise<void> {}

  protected databaseLabel(): string {
    return this.config.name;
  }

  protected override schemaDatabase(): string {
    return 'main';
  }

  override async databases(): Promise<string[]> {
    return ['main'];
  }

  override qualified(t: TableRef): string {
    return this.quote(t.table);
  }

  quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  protected param(): string {
    return '?';
  }

  private async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const start = Date.now();
    const account = encodeURIComponent(this.config.accountId!.trim());
    const database = encodeURIComponent(this.config.database!.trim());
    const response = await httpRequest({
      method: 'POST',
      url: `${this.apiBase}/accounts/${account}/d1/database/${database}/raw`,
      headers: { Authorization: `Bearer ${this.config.apiKey!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params: params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)) }),
      timeout: 30000,
    });
    let body: { success?: boolean; errors?: { message: string }[]; result?: D1Result[] };
    try {
      body = JSON.parse(response.body);
    } catch {
      throw new Error(`Cloudflare D1 returned HTTP ${response.status} with an invalid response.`);
    }
    if (response.status >= 400 || body.success === false || body.errors?.length)
      throw new Error(body.errors?.map((e) => e.message).join('; ') || `Cloudflare D1 returned HTTP ${response.status}.`);
    const result = body.result?.[0];
    if (!result || result.success === false) throw new Error(result?.error || 'Cloudflare D1 query failed.');
    const columns = result.results?.columns ?? [];
    return {
      columns: columns.map((name) => ({ name })),
      rows: (result.results?.rows ?? []).map((row) => row.map(toCell)),
      affectedRows: columns.length ? undefined : result.meta?.changes,
      message: columns.length ? undefined : `${result.meta?.changes ?? 0} row(s) affected`,
      durationMs: Date.now() - start,
    };
  }

  async run(sql: string, _database?: string, params?: unknown[]): Promise<QueryResult> {
    const statements = splitSql(sql, this.dialect);
    if (statements.length !== 1) throw new Error('Run exactly one SQL statement.');
    return this.config.readonly ? this.safeRead(statements[0].text, params) : this.execute(statements[0].text, params);
  }

  private async safeRead(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!/^(select|with)\b/i.test(stripComments(sql).trim())) throw new Error('Only read-only SELECT and WITH statements can run on Cloudflare D1 here.');
    // Compile without executing, then reject programs that open a write transaction.
    const plan = await this.execute(`EXPLAIN ${sql}`, params);
    const index = (name: string) => plan.columns.findIndex((c) => c.name.toLowerCase() === name);
    const opcode = index('opcode');
    const p2 = index('p2');
    if (opcode < 0 || p2 < 0 || plan.rows.some((row) => row[opcode] === 'OpenWrite' || (row[opcode] === 'Transaction' && Number(row[p2]) !== 0)))
      throw new Error('This query is not read-only.');
    return this.execute(sql, params);
  }

  protected async readOnly(sql: string): Promise<QueryResult> {
    return this.safeRead(sql);
  }

  protected async rows<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.execute(sql, params);
    return result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c.name, row[i]])) as T);
  }

  protected async transaction(_database: string | undefined, _statements: Exec[]): Promise<number> {
    throw new Error('Cloudflare D1 grid editing is unavailable. Run DML in the SQL editor.');
  }
}
