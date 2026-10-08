import * as mssql from 'mssql';
import { ColumnMeta, ConnectionConfig, DbNode, QueryResult, TableRef } from '../types';
import { toCell } from '../util';
import { Exec, RowChanges, SqlDriver } from './sql';
import { readOnlySelect } from './read-only-select';

export class MssqlDriver extends SqlDriver {
  readonly dialect = 'mssql' as const;
  private pools = new Map<string, Promise<mssql.ConnectionPool>>();

  constructor(
    config: ConnectionConfig,
    private readonly client = mssql,
  ) {
    super(config);
  }

  private async pool(database = this.config.database || 'master'): Promise<mssql.ConnectionPool> {
    const existing = this.pools.get(database);
    if (existing) return existing;
    const pending = (async () => {
      const { host, port } = await this.endpoint(1433);
      const pool = new this.client.ConnectionPool({
        server: host,
        port,
        database,
        user: this.config.user,
        password: this.config.password,
        connectionTimeout: 15000,
        requestTimeout: 30000,
        pool: { min: 0, max: 4 },
        options: { encrypt: this.config.ssl ?? true, trustServerCertificate: this.config.rejectUnauthorized === false, appName: 'DBDeck' },
      });
      pool.on('error', () => undefined);
      try {
        return await pool.connect();
      } catch (error) {
        await pool.close().catch(() => undefined);
        throw error;
      }
    })();
    this.pools.set(database, pending);
    try {
      return await pending;
    } catch (error) {
      this.pools.delete(database);
      throw error;
    }
  }

  async connect(): Promise<void> {
    await this.run('SELECT 1 AS connected');
  }
  protected async disconnect(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(
      pools
        .map(async (pool) => {
          await (await pool).close();
        })
        .map((p) => p.catch(() => undefined)),
    );
  }
  quote(name: string): string {
    return `[${name.replace(/\]/g, ']]')}]`;
  }
  protected param(i: number): string {
    return `@p${i}`;
  }

  private async execute(request: mssql.Request, sql: string, params: unknown[] = []): Promise<QueryResult> {
    params.forEach((value, i) =>
      request.input(
        `p${i + 1}`,
        value === undefined ? null : value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value) ? JSON.stringify(value) : value,
      ),
    );
    const start = Date.now();
    const result = await request.query(sql);
    const recordsets = result.recordsets as mssql.IRecordSet<Record<string, unknown>>[];
    const recordset = recordsets?.[recordsets.length - 1];
    const fields = Object.values(recordset?.columns ?? {}).sort((a, b) => a.index - b.index);
    return {
      columns: fields.map((c) => ({ name: c.name, type: (c.type as { name?: string }).name, nullable: c.nullable })),
      rows: (recordset ?? []).map((row) => fields.map((c) => toCell(row[c.name]))),
      affectedRows: fields.length ? undefined : result.rowsAffected.reduce((sum, n) => sum + n, 0),
      durationMs: Date.now() - start,
    };
  }
  async run(sql: string, database?: string, params?: unknown[]): Promise<QueryResult> {
    if (this.config.readonly) sql = readOnlySelect(sql, this.dialect, true);
    return this.execute((await this.pool(database)).request(), sql, params);
  }
  protected async readOnly(sql: string, database?: string): Promise<QueryResult> {
    return this.execute((await this.pool(database)).request(), readOnlySelect(sql, this.dialect, true));
  }
  protected async transaction(database: string | undefined, statements: Exec[]): Promise<number> {
    const tx = new this.client.Transaction(await this.pool(database));
    await tx.begin();
    try {
      let total = 0;
      for (const statement of statements) total += (await this.execute(new this.client.Request(tx), statement.sql, statement.params)).affectedRows ?? 0;
      await tx.commit();
      return total;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }
  override async apply(t: TableRef, changes: RowChanges): Promise<number> {
    const generated = new Set((await this.columns(t)).filter((c) => c.generated).map((c) => c.name));
    if (changes.updates.some((update) => Object.keys(update.values).some((key) => generated.has(key)))) throw new Error('Generated SQL Server columns cannot be edited.');
    return super.apply(t, { ...changes, inserts: changes.inserts.map((row) => Object.fromEntries(Object.entries(row).filter(([name]) => !generated.has(name)))) });
  }
  private async query(sql: string, database?: string, params?: unknown[]): Promise<unknown[][]> {
    return (await this.run(sql, database, params)).rows;
  }

  async databases(): Promise<string[]> {
    const rows = await this.query(`SELECT name FROM sys.databases WHERE state = 0 AND HAS_DBACCESS(name) = 1 ${this.config.showSystem ? '' : 'AND database_id > 4'} ORDER BY name`);
    const names = rows.map((r) => String(r[0]));
    return names.length ? names : [this.config.database || 'master'];
  }
  async objects(database?: string, schema?: string, limit: number | null = 5000): Promise<{ name: string; schema?: string }[]> {
    const rows = await this.query(
      `SELECT ${limit === null ? '' : `TOP (${limit})`} o.name, s.name FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE o.type IN ('U','V') ${this.config.showSystem ? '' : 'AND o.is_ms_shipped = 0'} ${schema ? 'AND s.name = @p1' : ''} ORDER BY s.name, o.name`,
      database,
      schema ? [schema] : [],
    );
    return rows.map((r) => ({ name: String(r[0]), schema: String(r[1]) }));
  }
  async columns(t: TableRef): Promise<ColumnMeta[]> {
    const rows = await this.query(
      `SELECT c.name,
      ty.name + CASE WHEN ty.name IN ('varchar','char','varbinary','binary','nvarchar','nchar') THEN '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE CONVERT(varchar(10), CASE WHEN ty.name IN ('nvarchar','nchar') THEN c.max_length / 2 ELSE c.max_length END) END + ')'
      WHEN ty.name IN ('decimal','numeric') THEN '(' + CONVERT(varchar(10), c.precision) + ',' + CONVERT(varchar(10), c.scale) + ')' ELSE '' END,
      c.is_nullable, dc.definition, CONVERT(bit, CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id WHERE i.object_id = c.object_id AND i.is_primary_key = 1 AND ic.column_id = c.column_id) THEN 1 ELSE 0 END),
      c.is_identity, c.is_computed, CONVERT(nvarchar(max), ep.value), CONVERT(varchar(40), idc.seed_value), CONVERT(varchar(40), idc.increment_value)
      FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
      LEFT JOIN sys.identity_columns idc ON idc.object_id = c.object_id AND idc.column_id = c.column_id
      LEFT JOIN sys.extended_properties ep ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
      WHERE c.object_id = OBJECT_ID(@p1) ORDER BY c.column_id`,
      t.database,
      [this.qualified(t)],
    );
    return rows.map((r) => ({
      name: String(r[0]),
      type: `${r[1]}${r[5] ? ` IDENTITY(${r[8]},${r[9]})` : ''}`,
      nullable: Boolean(r[2]),
      defaultValue: r[3] == null ? null : String(r[3]),
      pk: Boolean(r[4]),
      generated: Boolean(r[5] || r[6]) || /^(timestamp|rowversion)$/i.test(String(r[1])),
      comment: r[7] == null ? undefined : String(r[7]),
    }));
  }
  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) return (await this.databases()).map((db) => this.node('database', db, { database: db, icon: 'database', tags: 'database sql', expanded: db === this.config.database }));
    if (n.kind === 'database') {
      const rows = await this.query(
        `SELECT name FROM sys.schemas WHERE ${this.config.showSystem ? '1=1' : "name NOT IN ('sys','INFORMATION_SCHEMA') AND principal_id < 16384"} ORDER BY name`,
        n.database,
      );
      return rows.map((r) =>
        this.node('schema', String(r[0]), { database: n.database, schema: String(r[0]), icon: 'symbol-namespace', tags: 'schema sql', expanded: r[0] === 'dbo' }),
      );
    }
    if (n.kind === 'schema')
      return ['tables', 'views', 'routines'].map((ref) =>
        this.node('folder', ref === 'routines' ? 'Procedures & functions' : ref === 'tables' ? 'Tables' : 'Views', {
          database: n.database,
          schema: n.schema,
          ref,
          icon: 'folder-library',
          tags: 'folder',
        }),
      );
    if (n.kind === 'folder') {
      const kinds = n.ref === 'tables' ? "('U')" : n.ref === 'views' ? "('V')" : "('P','FN','IF','TF')";
      const rows = await this.query(
        `SELECT o.name FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = @p1 AND o.type IN ${kinds} ${this.config.showSystem ? '' : 'AND o.is_ms_shipped = 0'} ORDER BY o.name`,
        n.database,
        [n.schema],
      );
      const kind = n.ref === 'tables' ? 'table' : n.ref === 'views' ? 'view' : 'routine';
      return rows.map((r) =>
        this.node(kind, String(r[0]), {
          database: n.database,
          schema: n.schema,
          table: String(r[0]),
          icon: kind === 'table' ? 'table' : kind === 'view' ? 'eye' : 'symbol-method',
          tags: `${kind} sql`,
          leaf: kind === 'routine',
        }),
      );
    }
    if (n.kind === 'table' || n.kind === 'view')
      return (await this.columns({ database: n.database, schema: n.schema, table: n.table! })).map((c) =>
        this.node('column', c.name, {
          database: n.database,
          schema: n.schema,
          table: n.table,
          description: c.type,
          icon: c.pk ? 'key' : 'symbol-field',
          leaf: true,
          tags: 'column',
        }),
      );
    return [];
  }
  async ddl(t: TableRef, kind: string): Promise<string> {
    if (kind === 'view' || kind === 'routine') {
      const rows = await this.query('SELECT OBJECT_DEFINITION(OBJECT_ID(@p1))', t.database, [this.qualified(t)]);
      return String(rows[0]?.[0] ?? '/* Definition unavailable. VIEW DEFINITION permission may be required. */');
    }
    const columns = await this.columns(t);
    const computed = await this.query('SELECT name, definition FROM sys.computed_columns WHERE object_id = OBJECT_ID(@p1)', t.database, [this.qualified(t)]);
    const definitions = new Map(computed.map((r) => [String(r[0]), String(r[1])]));
    const lines = columns.map((c) =>
      definitions.has(c.name)
        ? `  ${this.quote(c.name)} AS ${definitions.get(c.name)}`
        : `  ${this.quote(c.name)} ${c.type}${c.nullable ? ' NULL' : ' NOT NULL'}${c.defaultValue ? ` DEFAULT ${c.defaultValue}` : ''}`,
    );
    const keys = await this.query(
      `SELECT c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id WHERE i.object_id = OBJECT_ID(@p1) AND i.is_primary_key = 1 ORDER BY ic.key_ordinal`,
      t.database,
      [this.qualified(t)],
    );
    if (keys.length) lines.push(`  PRIMARY KEY (${keys.map((r) => this.quote(String(r[0]))).join(', ')})`);
    return `CREATE TABLE ${this.qualified(t)} (\n${lines.join(',\n')}\n);`;
  }
}
