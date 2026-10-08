import * as oracledb from 'oracledb';
import { splitSql } from '../sqlSplit';
import { ColumnMeta, ConnectionConfig, DbNode, QueryResult, TableRef } from '../types';
import { toCell } from '../util';
import { Exec, SqlDriver } from './sql';

export function oracleNumber(value: unknown): number | string | null {
  if (value === null) return null;
  const text = String(value);
  const number = Number(text);
  if (!Number.isFinite(number)) return text;
  if (Number.isInteger(number)) return Number.isSafeInteger(number) ? number : text;
  return text.replace(/[^0-9]/g, '').replace(/^0+/, '').length <= 15 ? number : text;
}

export class OracleDriver extends SqlDriver {
  readonly dialect = 'oracle' as const;
  private pool?: oracledb.Pool;

  constructor(
    config: ConnectionConfig,
    private readonly client = oracledb,
  ) {
    super(config);
  }

  async connect(): Promise<void> {
    if (!this.config.database?.trim()) throw new Error('Enter the Oracle service name, for example FREEPDB1.');
    if (!this.config.user?.trim()) throw new Error('Enter the Oracle username.');
    const { host, port } = await this.endpoint(1521);
    const address = host.includes(':') ? `[${host}]` : host;
    this.pool = await this.client.createPool({
      user: this.config.user.trim(),
      password: this.config.password,
      connectString: `${this.config.ssl ? 'tcps' : 'tcp'}://${address}:${port}/${this.config.database.trim()}?connect_timeout=15`,
      sslServerDNMatch: this.config.rejectUnauthorized ?? true,
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
      queueTimeout: 15000,
    });
    try {
      await this.run('SELECT 1 FROM DUAL');
    } catch (e) {
      await this.disconnect();
      throw e;
    }
  }

  protected async disconnect(): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    await pool?.close(0);
  }

  private async connection(timeout = 0): Promise<oracledb.Connection> {
    if (!this.pool) throw new Error('Not connected');
    const connection = await this.pool.getConnection();
    connection.callTimeout = timeout;
    return connection;
  }

  quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  protected param(i: number): string {
    return `:${i}`;
  }

  protected override async defaultInsert(t: TableRef): Promise<string> {
    const [column] = await this.columns(t);
    if (!column) throw new Error('Cannot read the table columns to insert a default row.');
    return `INSERT INTO ${this.qualified(t)} (${this.quote(column.name)}) VALUES (DEFAULT)`;
  }

  private statement(sql: string): string {
    const statements = splitSql(sql, this.dialect);
    if (statements.length !== 1) throw new Error('Run exactly one SQL statement.');
    return statements[0].text;
  }

  private async execute(connection: oracledb.Connection, sql: string, params: unknown[] = [], autoCommit = false): Promise<QueryResult> {
    const start = Date.now();
    const binds = params.map((v) =>
      v === undefined ? null : v instanceof Uint8Array ? Buffer.from(v) : v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v,
    ) as oracledb.BindParameters;
    const result = await connection.execute<unknown[]>(sql, binds, {
      autoCommit,
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      maxRows: 10001,
      fetchTypeHandler: (meta) =>
        meta.dbType === oracledb.DB_TYPE_NUMBER
          ? { type: oracledb.STRING, converter: oracleNumber }
          : meta.dbType === oracledb.DB_TYPE_CLOB || meta.dbType === oracledb.DB_TYPE_NCLOB
            ? { type: oracledb.STRING }
            : meta.dbType === oracledb.DB_TYPE_BLOB
              ? { type: oracledb.BUFFER }
              : undefined,
    });
    return {
      columns: (result.metaData ?? []).map((c) => ({ name: c.name, type: c.dbTypeName })),
      rows: (result.rows ?? []).slice(0, 10000).map((row) => row.map(toCell)),
      truncated: (result.rows?.length ?? 0) > 10000,
      affectedRows: result.rowsAffected,
      message: result.metaData ? undefined : `${result.rowsAffected ?? 0} row(s) affected`,
      durationMs: Date.now() - start,
    };
  }

  async run(sql: string, _database?: string, params?: unknown[]): Promise<QueryResult> {
    const text = this.statement(sql);
    if (this.config.readonly) return this.select(text, params);
    const connection = await this.connection();
    try {
      return await this.execute(connection, text, params, true);
    } finally {
      await connection.close();
    }
  }

  private async select(sql: string, params?: unknown[]): Promise<QueryResult> {
    // Only SELECT is accepted: DDL and PL/SQL can commit implicitly in Oracle.
    if (!/^\s*(?:\/\*[\s\S]*?\*\/\s*|--[^\n]*\n\s*)*(select|with)\b/i.test(sql)) throw new Error('Only read-only SELECT and WITH statements can run on Oracle here.');
    const connection = await this.connection(30000);
    try {
      await connection.execute('SET TRANSACTION READ ONLY');
      const info = await connection.getStatementInfo(sql);
      if (info.statementType !== oracledb.STMT_TYPE_SELECT) throw new Error('This query is not read-only.');
      return await this.execute(connection, sql, params);
    } finally {
      await connection.rollback().catch(() => undefined);
      await connection.close();
    }
  }

  protected async readOnly(sql: string): Promise<QueryResult> {
    return this.select(this.statement(sql));
  }

  protected async transaction(_database: string | undefined, statements: Exec[]): Promise<number> {
    const connection = await this.connection();
    let total = 0;
    try {
      for (const statement of statements) total += (await this.execute(connection, statement.sql, statement.params)).affectedRows ?? 0;
      await connection.commit();
      return total;
    } catch (e) {
      await connection.rollback().catch(() => undefined);
      throw e;
    } finally {
      await connection.close();
    }
  }

  async databases(): Promise<string[]> {
    return [this.config.database!];
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    const database = this.config.database!;
    if (!n) return [this.node('database', database, { database, icon: 'database', expanded: true, tags: 'database sql' })];
    if (n.kind === 'database') {
      const result = await this.run(`SELECT DISTINCT o.owner FROM all_objects o JOIN all_users u ON u.username = o.owner
        WHERE o.object_type IN ('TABLE', 'VIEW') ${this.config.showSystem ? '' : "AND u.oracle_maintained = 'N'"} ORDER BY o.owner`);
      return result.rows.map(([owner]) =>
        this.node('schema', String(owner), { database, schema: String(owner), icon: 'symbol-namespace', tags: 'schema sql', expanded: owner === this.config.user?.toUpperCase() }),
      );
    }
    if (n.kind === 'schema')
      return ['Tables', 'Views'].map((label) => this.node('folder', label, { database, schema: n.schema, ref: label.toLowerCase(), icon: 'folder-library', tags: 'folder' }));
    if (n.kind === 'folder') {
      const kind = n.ref === 'tables' ? 'table' : 'view';
      const result = await this.run('SELECT object_name FROM all_objects WHERE owner = :1 AND object_type = :2 ORDER BY object_name', undefined, [n.schema, kind.toUpperCase()]);
      return result.rows.map(([name]) =>
        this.node(kind, String(name), { database, schema: n.schema, table: String(name), icon: kind === 'table' ? 'table' : 'eye', tags: `${kind} sql` }),
      );
    }
    if (n.kind === 'table' || n.kind === 'view')
      return (await this.columns({ table: n.table!, schema: n.schema })).map((c) =>
        this.node('column', c.name, { database, schema: n.schema, table: n.table, description: c.type, icon: c.pk ? 'key' : 'symbol-field', leaf: true, tags: 'column' }),
      );
    return [];
  }

  async columns(t: TableRef): Promise<ColumnMeta[]> {
    const params = [t.schema || this.config.user!.toUpperCase(), t.table];
    const result = await this.run(
      `SELECT c.column_name, c.data_type, c.nullable, m.comments, c.data_default
      FROM all_tab_columns c LEFT JOIN all_col_comments m ON m.owner = c.owner AND m.table_name = c.table_name AND m.column_name = c.column_name
      WHERE c.owner = :1 AND c.table_name = :2 ORDER BY c.column_id`,
      undefined,
      params,
    );
    const keys = await this.run(
      `SELECT p.column_name FROM all_constraints k JOIN all_cons_columns p ON p.owner = k.owner AND p.constraint_name = k.constraint_name
      WHERE k.constraint_type = 'P' AND k.owner = :1 AND k.table_name = :2`,
      undefined,
      params,
    );
    const primaryKeys = new Set(keys.rows.map(([name]) => name));
    return result.rows.map(([name, type, nullable, comment, defaultValue]) => ({
      name: String(name),
      type: String(type),
      nullable: nullable === 'Y',
      defaultValue: defaultValue == null ? null : String(defaultValue).trim(),
      pk: primaryKeys.has(name),
      comment: comment == null ? undefined : String(comment),
    }));
  }

  async objects(_database?: string, schema?: string, limit: number | null = 5000): Promise<{ name: string; schema: string }[]> {
    const sql = `SELECT o.object_name, o.owner FROM all_objects o JOIN all_users u ON u.username = o.owner WHERE o.object_type IN ('TABLE', 'VIEW')
      ${schema ? 'AND o.owner = :1' : this.config.showSystem ? '' : "AND u.oracle_maintained = 'N'"} ORDER BY o.owner, o.object_name`;
    const result = await this.run(limit === null ? sql : this.paginate(sql, limit), undefined, schema ? [schema] : []);
    return result.rows.map(([name, owner]) => ({ name: String(name), schema: String(owner) }));
  }

  async ddl(t: TableRef, kind: string): Promise<string> {
    const result = await this.run('SELECT DBMS_METADATA.GET_DDL(:1, :2, :3) FROM DUAL', undefined, [
      kind === 'view' ? 'VIEW' : 'TABLE',
      t.table,
      t.schema || this.config.user!.toUpperCase(),
    ]);
    return String(result.rows[0]?.[0] ?? '');
  }
}
