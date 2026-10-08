import { Client, auth, types } from 'cassandra-driver';
import { ColumnMeta, ConnectionConfig, DbNode, QueryResult, TableRef, ValueSearchPage } from '../types';
import { toCell } from '../util';
import { CursorPages } from './cursor-pages';
import { readOnlySelect } from './read-only-select';
import { Exec, PageOptions, SqlDriver } from './sql';

export function cassandraType(type: { code: number; info?: unknown }): string {
  const name = Object.entries(types.dataTypes).find(([, code]) => code === type.code)?.[0] ?? String(type.code);
  if (name === 'list' || name === 'set') return `${name}<${cassandraType(type.info as { code: number })}>`;
  if (name === 'map' || name === 'tuple') return `${name}<${(type.info as { code: number }[]).map(cassandraType).join(', ')}>`;
  if (name === 'udt') {
    const info = type.info as { keyspace: string; name: string };
    return `"${info.keyspace.replace(/"/g, '""')}"."${info.name.replace(/"/g, '""')}"`;
  }
  return name;
}

export function cassandraCell(value: unknown): unknown {
  if (
    value instanceof types.Long ||
    value instanceof types.Integer ||
    value instanceof types.BigDecimal ||
    value instanceof types.Uuid ||
    value instanceof types.InetAddress ||
    value instanceof types.LocalDate ||
    value instanceof types.LocalTime ||
    value instanceof types.Duration
  )
    return value.toString();
  if (value instanceof types.Tuple) return value.values().map(cassandraCell);
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, v]) => [String(key), cassandraCell(v)]));
  if (value instanceof Set || Array.isArray(value)) return [...value].map(cassandraCell);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cassandraCell(v)]));
  return toCell(value);
}

export class CassandraDriver extends SqlDriver {
  readonly dialect = 'cassandra' as const;
  override readonly editable = false;
  private client?: Client;
  private readonly keyspaces = new Map<string, Promise<Client>>();
  private readonly pages = new CursorPages<types.Row>();

  constructor(
    config: ConnectionConfig,
    private readonly createClient = (options: ConstructorParameters<typeof Client>[0]) => new Client(options),
  ) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this.config.ssh?.enabled) throw new Error('Cassandra cluster discovery does not support an SSH tunnel. Use a reachable cluster contact point.');
    this.client = this.createClient(this.options());
    try {
      await this.client.connect();
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }
  private options(): ConstructorParameters<typeof Client>[0] {
    return {
      contactPoints: [this.config.host || '127.0.0.1'],
      localDataCenter: this.config.localDatacenter || 'datacenter1',
      protocolOptions: { port: this.config.port || 9042 },
      keyspace: this.config.database || undefined,
      authProvider: this.config.user ? new auth.PlainTextAuthProvider(this.config.user, this.config.password || '') : undefined,
      sslOptions: this.config.ssl ? { rejectUnauthorized: this.config.rejectUnauthorized ?? true } : undefined,
      socketOptions: { connectTimeout: 15000, readTimeout: 30000 },
    };
  }
  protected async disconnect(): Promise<void> {
    const clients = [Promise.resolve(this.client), ...this.keyspaces.values()];
    this.client = undefined;
    this.keyspaces.clear();
    this.pages.clear();
    await Promise.all(
      clients
        .map(async (client) => {
          await (await client)?.shutdown();
        })
        .map((p) => p.catch(() => undefined)),
    );
  }
  private async clientFor(database?: string): Promise<Client> {
    if (!database || database === this.config.database) return this.connected();
    this.connected();
    let pending = this.keyspaces.get(database);
    if (!pending) {
      const client = this.createClient({ ...this.options(), keyspace: database });
      pending = client
        .connect()
        .then(() => client)
        .catch(async (error) => {
          this.keyspaces.delete(database);
          await client.shutdown().catch(() => undefined);
          throw error;
        });
      this.keyspaces.set(database, pending);
    }
    return pending;
  }
  private connected(): Client {
    if (!this.client) throw new Error('Not connected');
    return this.client;
  }
  quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }
  protected param(): string {
    return '?';
  }
  protected async transaction(_database: string | undefined, _statements: Exec[]): Promise<number> {
    throw new Error('Cassandra does not support staged SQL transactions. Run CQL in the query editor.');
  }
  private result(result: types.ResultSet, durationMs: number): QueryResult {
    const columns = result.columns ?? [];
    return {
      columns: columns.map((c) => ({ name: c.name, type: cassandraType(c.type) })),
      rows: (result.rows ?? []).map((r) => columns.map((c) => cassandraCell(r[c.name]))),
      durationMs,
      message: result.rows ? undefined : 'Statement executed',
      truncated: !!result.pageState,
    };
  }
  async run(sql: string, database?: string, params: unknown[] = []): Promise<QueryResult> {
    if (this.config.readonly) sql = readOnlySelect(sql, this.dialect);
    const start = Date.now();
    return this.result(await (await this.clientFor(database)).execute(sql, params, { prepare: params.length > 0, fetchSize: 10000 }), Date.now() - start);
  }
  protected async readOnly(sql: string, database?: string): Promise<QueryResult> {
    return this.run(readOnlySelect(sql, this.dialect), database);
  }
  override selectSql(t: TableRef, o: PageOptions): string {
    if (o.search?.trim()) throw new Error('Cassandra has no full-text table search. Use a key-based CQL WHERE filter.');
    let sql = `SELECT * FROM ${this.qualified(t)}`;
    if (o.where?.trim()) sql += ` WHERE ${o.where.trim()}`;
    if (o.orderBy?.trim()) sql += ` ORDER BY ${o.orderBy.trim()}`;
    return `${sql} LIMIT ${o.limit}`;
  }
  override async page(t: TableRef, o: PageOptions): Promise<QueryResult> {
    const start = Date.now();
    // A CQL LIMIT applies to the whole result, so native paging uses no LIMIT.
    const sql = this.selectSql(t, o).replace(/ LIMIT \d+$/, '');
    readOnlySelect(sql, this.dialect);
    let columns: types.ResultSet['columns'] = [];
    const page = await this.pages.page(JSON.stringify([sql, o.limit]), o.limit, o.offset, async (pageState) => {
      const rows: types.Row[] = [];
      let next = pageState;
      do {
        const r = await this.connected().execute(sql, [], { fetchSize: o.limit - rows.length, pageState: next });
        columns = r.columns;
        rows.push(...r.rows);
        next = r.pageState || undefined;
      } while (next && rows.length < o.limit);
      return { rows, next };
    });
    const metadata = await this.columns(t);
    return {
      columns: columns.map((c) => ({ ...metadata.find((m) => m.name === c.name), name: c.name, type: cassandraType(c.type) })),
      rows: page.rows.map((r) => columns.map((c) => cassandraCell(r[c.name]))),
      durationMs: Date.now() - start,
      truncated: !!page.next,
    };
  }
  override async count(t: TableRef, where?: string, search?: string): Promise<number> {
    if (search?.trim()) throw new Error('Cassandra has no full-text table search.');
    return Number((await this.run(`SELECT COUNT(*) FROM ${this.qualified(t)}${where?.trim() ? ` WHERE ${where.trim()}` : ''}`)).rows[0]?.[0] ?? 0);
  }
  override async searchValues(_t: TableRef, _search: string, _cancelled: () => boolean): Promise<ValueSearchPage> {
    throw new Error('Cassandra has no full-text table search. Use a key-based CQL WHERE filter.');
  }
  async databases(): Promise<string[]> {
    const r = await this.connected().execute('SELECT keyspace_name FROM system_schema.keyspaces');
    return r.rows
      .map((row) => String(row.keyspace_name))
      .filter((name) => this.config.showSystem || !name.startsWith('system'))
      .sort();
  }
  async objects(database = this.config.database, _schema?: string, limit: number | null = 5000): Promise<{ name: string }[]> {
    if (!database) throw new Error('Choose a Cassandra keyspace.');
    const r = await this.connected().execute('SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?', [database], { prepare: true });
    const rows = r.rows.map((row) => ({ name: String(row.table_name) })).sort((a, b) => a.name.localeCompare(b.name));
    return limit === null ? rows : rows.slice(0, limit);
  }
  async columns(t: TableRef): Promise<ColumnMeta[]> {
    const r = await this.connected().execute(
      'SELECT column_name, type, kind, position FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?',
      [t.database || this.config.database, t.table],
      { prepare: true },
    );
    return r.rows
      .sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || Number(a.position) - Number(b.position) || String(a.column_name).localeCompare(String(b.column_name)))
      .map((row) => ({
        name: String(row.column_name),
        type: String(row.type),
        pk: row.kind === 'partition_key' || row.kind === 'clustering',
        nullable: row.kind !== 'partition_key' && row.kind !== 'clustering',
      }));
  }
  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n)
      return (await this.databases()).map((db) =>
        this.node('database', db, { database: db, icon: 'database', tags: 'database sql cassandra', expanded: db === this.config.database }),
      );
    if (n.kind === 'database')
      return (await this.objects(n.database, undefined, null)).map((t) =>
        this.node('table', t.name, { database: n.database, table: t.name, icon: 'table', tags: 'table sql cassandra' }),
      );
    if (n.kind === 'table')
      return (await this.columns({ database: n.database, table: n.table! })).map((c) =>
        this.node('column', c.name, { database: n.database, table: n.table, description: c.type, icon: c.pk ? 'key' : 'symbol-field', leaf: true, tags: 'column' }),
      );
    return [];
  }
  async ddl(t: TableRef): Promise<string> {
    const table = await this.connected().metadata.getTable(t.database || this.config.database!, t.table);
    if (!table) throw new Error('Table metadata unavailable.');
    const partition = table.partitionKeys.map((c) => this.quote(c.name));
    const clustering = table.clusteringKeys.map((c) => this.quote(c.name));
    const raw = await this.connected().execute(
      'SELECT column_name, type, kind FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?',
      [t.database || this.config.database, t.table],
      { prepare: true },
    );
    const lines = raw.rows.map((c) => `  ${this.quote(String(c.column_name))} ${c.type}${c.kind === 'static' ? ' STATIC' : ''}`);
    lines.push(`  PRIMARY KEY ((${partition.join(', ')})${clustering.length ? `, ${clustering.join(', ')}` : ''})`);
    return `CREATE TABLE ${this.qualified(t)} (\n${lines.join(',\n')}\n)${clustering.length ? ` WITH CLUSTERING ORDER BY (${clustering.map((name, i) => `${name} ${table.clusteringOrder[i]}`).join(', ')})` : ''};`;
  }
}
