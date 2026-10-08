import { AttributeValue, DescribeTableCommand, DynamoDBClient, DynamoDBClientConfig, ExecuteStatementCommand, ListTablesCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, NumberValueImpl, unmarshall } from '@aws-sdk/util-dynamodb';
import { ColumnMeta, ConnectionConfig, DbNode, QueryResult, TableRef, ValueSearchPage } from '../types';
import { CursorPages } from './cursor-pages';
import { readOnlySelect } from './read-only-select';
import { Exec, PageOptions, SqlDriver } from './sql';

export function dynamoGrid(items: Record<string, AttributeValue>[], keys: ColumnMeta[] = []): Pick<QueryResult, 'columns' | 'rows'> {
  const docs = items.map((item) => unmarshall(item, { wrapNumbers: true }));
  const names = [...new Set([...keys.map((c) => c.name), ...docs.flatMap(Object.keys)])];
  const cell = (value: unknown): unknown => {
    if (value === undefined) return null;
    if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
    if (value instanceof Set || Array.isArray(value)) return [...value].map(cell);
    if (value && typeof value === 'object') {
      // NumberValue uses the original decimal string, avoiding precision loss.
      if (value instanceof NumberValueImpl) return String((value as { value: string }).value);
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cell(v)]));
    }
    return value;
  };
  return { columns: names.map((name) => ({ name, ...keys.find((c) => c.name === name) })), rows: docs.map((doc) => names.map((name) => cell(doc[name]))) };
}

export class DynamoDbDriver extends SqlDriver {
  readonly dialect = 'dynamodb' as const;
  override readonly editable = false;
  private client?: DynamoDBClient;
  private readonly pages = new CursorPages<Record<string, AttributeValue>>();

  constructor(
    config: ConnectionConfig,
    private readonly createClient = (options: DynamoDBClientConfig) => new DynamoDBClient(options),
  ) {
    super(config);
  }

  async connect(): Promise<void> {
    if (!!this.config.user !== !!this.config.password) throw new Error('Enter both AWS access key ID and secret access key, or leave both empty to use the AWS credential chain.');
    if (this.config.sessionToken && !this.config.user) throw new Error('Temporary AWS credentials require an access key ID and secret access key.');
    this.client = this.createClient({
      region: this.config.region || 'us-east-1',
      requestHandler: { connectionTimeout: 15000, requestTimeout: 30000 },
      endpoint: this.config.endpoint || undefined,
      credentials:
        this.config.user && this.config.password
          ? { accessKeyId: this.config.user, secretAccessKey: this.config.password, sessionToken: this.config.sessionToken || undefined }
          : undefined,
    });
    try {
      await this.client.send(new ListTablesCommand({ Limit: 1 }));
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }
  private connected(): DynamoDBClient {
    if (!this.client) throw new Error('Not connected');
    return this.client;
  }
  protected async disconnect(): Promise<void> {
    this.client?.destroy();
    this.client = undefined;
    this.pages.clear();
  }
  quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }
  override qualified(t: TableRef): string {
    return this.quote(t.table);
  }
  protected param(): string {
    return '?';
  }
  protected async transaction(_database: string | undefined, _statements: Exec[]): Promise<number> {
    throw new Error('DynamoDB grid edits are unavailable. Run PartiQL in the query editor.');
  }

  async run(sql: string, _database?: string, params: unknown[] = []): Promise<QueryResult> {
    if (this.config.readonly) sql = readOnlySelect(sql, this.dialect);
    const start = Date.now();
    const result = await this.connected().send(
      new ExecuteStatementCommand({ Statement: sql, Parameters: params.length ? params.map((value) => marshall({ value }, { removeUndefinedValues: true }).value) : undefined }),
    );
    return {
      ...dynamoGrid(result.Items ?? []),
      durationMs: Date.now() - start,
      truncated: !!result.NextToken || !!result.LastEvaluatedKey,
      message: result.Items ? undefined : 'Statement executed',
    };
  }
  protected async readOnly(sql: string, database?: string): Promise<QueryResult> {
    return this.run(readOnlySelect(sql, this.dialect), database);
  }
  override selectSql(t: TableRef, o: PageOptions): string {
    if (o.search?.trim()) throw new Error('DynamoDB has no full-text table search. Use a PartiQL WHERE filter.');
    let sql = `SELECT * FROM ${this.qualified(t)}`;
    if (o.where?.trim()) sql += ` WHERE ${o.where.trim()}`;
    if (o.orderBy?.trim()) sql += ` ORDER BY ${o.orderBy.trim()}`;
    // DynamoDB accepts Limit as an API option, not a PartiQL LIMIT/OFFSET clause.
    return sql;
  }
  override async page(t: TableRef, o: PageOptions): Promise<QueryResult> {
    const start = Date.now();
    const sql = this.selectSql(t, o);
    readOnlySelect(sql, this.dialect);
    const page = await this.pages.page(JSON.stringify([sql, o.limit]), o.limit, o.offset, async (cursor) => {
      const items: Record<string, AttributeValue>[] = [];
      let next = cursor;
      do {
        if (!o.where?.trim() && !o.orderBy?.trim()) {
          const key = next ? (JSON.parse(next) as Record<string, AttributeValue>) : undefined;
          if (key) for (const attr of Object.values(key)) if (attr.B) attr.B = Buffer.from(attr.B as unknown as string, 'base64');
          const result = await this.connected().send(new ScanCommand({ TableName: t.table, Limit: o.limit - items.length, ExclusiveStartKey: key }));
          items.push(...(result.Items ?? []));
          const cursor = result.LastEvaluatedKey;
          next = cursor
            ? JSON.stringify(Object.fromEntries(Object.entries(cursor).map(([name, value]) => [name, value.B ? { B: Buffer.from(value.B).toString('base64') } : value])))
            : undefined;
          continue;
        }
        const result = await this.connected().send(new ExecuteStatementCommand({ Statement: sql, Limit: o.limit - items.length, NextToken: next }));
        items.push(...(result.Items ?? []));
        next = result.NextToken;
        if (!next && result.LastEvaluatedKey) throw new Error('DynamoDB returned a key without a continuation token. Use a key-based WHERE query to page these items.');
      } while (next && items.length < o.limit);
      return { rows: items, next };
    });
    return { ...dynamoGrid(page.rows, await this.columns(t)), durationMs: Date.now() - start, truncated: !!page.next };
  }
  override async count(_t: TableRef, _where?: string, _search?: string): Promise<number> {
    throw new Error('DynamoDB does not provide exact row counts for this view.');
  }
  override async searchValues(_t: TableRef, _search: string, _cancelled: () => boolean): Promise<ValueSearchPage> {
    throw new Error('DynamoDB has no full-text table search. Use a PartiQL WHERE filter.');
  }
  async databases(): Promise<string[]> {
    return [this.config.region || 'us-east-1'];
  }
  async objects(_database?: string, _schema?: string, limit: number | null = 5000): Promise<{ name: string }[]> {
    const names: string[] = [];
    let start: string | undefined;
    do {
      const result = await this.connected().send(new ListTablesCommand({ ExclusiveStartTableName: start }));
      names.push(...(result.TableNames ?? []));
      start = result.LastEvaluatedTableName;
    } while (start && (limit === null || names.length < limit));
    return (limit === null ? names : names.slice(0, limit)).map((name) => ({ name }));
  }
  async columns(t: TableRef): Promise<ColumnMeta[]> {
    const table = (await this.connected().send(new DescribeTableCommand({ TableName: t.table }))).Table;
    return (table?.KeySchema ?? []).map((key) => ({
      name: key.AttributeName!,
      type: table?.AttributeDefinitions?.find((a) => a.AttributeName === key.AttributeName)?.AttributeType,
      pk: true,
      nullable: false,
    }));
  }
  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) return (await this.databases()).map((db) => this.node('database', db, { database: db, icon: 'cloud', tags: 'database sql dynamodb', expanded: true }));
    if (n.kind === 'database')
      return (await this.objects(undefined, undefined, null)).map((t) =>
        this.node('table', t.name, { database: n.database, table: t.name, icon: 'table', tags: 'table sql dynamodb' }),
      );
    if (n.kind === 'table')
      return (await this.columns({ table: n.table! })).map((c) =>
        this.node('column', c.name, { database: n.database, table: n.table, description: c.type, icon: 'key', leaf: true, tags: 'column' }),
      );
    return [];
  }
  async ddl(t: TableRef): Promise<string> {
    return JSON.stringify((await this.connected().send(new DescribeTableCommand({ TableName: t.table }))).Table, null, 2);
  }
}
