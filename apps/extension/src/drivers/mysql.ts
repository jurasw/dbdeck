import * as mysql from 'mysql2/promise';
import { Types } from 'mysql2';
import { ColumnMeta, DbNode, QueryResult, TableRef } from '../types';
import { formatCount, toCell } from '../util';
import { Exec, SqlDriver } from './sql';

const TYPE_NAMES = new Map<number, string>(Object.entries(Types as unknown as Record<string, number>).map(([k, v]) => [v, k.toLowerCase()]));
const SYSTEM_DBS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

export class MysqlDriver extends SqlDriver {
  readonly dialect = 'mysql' as const;
  private pool?: mysql.Pool;

  async connect(): Promise<void> {
    const { host, port } = await this.endpoint(3306);
    this.pool = mysql.createPool({
      host,
      port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database || undefined,
      ssl: this.config.ssl ? { rejectUnauthorized: this.config.rejectUnauthorized ?? false } : undefined,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectionLimit: 4,
      connectTimeout: 15000,
      charset: 'utf8mb4',
      multipleStatements: false,
    });
    const c = await this.pool.getConnection();
    c.release();
  }

  protected async disconnect(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }

  quote(name: string): string {
    return `\`${name.replace(/`/g, '``')}\``;
  }

  protected param(): string {
    return '?';
  }

  private async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool!.query(sql, params);
    return rows as T[];
  }

  async run(sql: string, database?: string, params?: unknown[]): Promise<QueryResult> {
    const c = await this.pool!.getConnection();
    try {
      if (database) await c.query(`USE ${this.quote(database)}`);
      const t = Date.now();
      let [rows, fields] = (await c.query({ sql, rowsAsArray: true, values: params })) as [unknown, unknown];
      const durationMs = Date.now() - t;
      if (Array.isArray(fields) && Array.isArray(fields[0])) {
        rows = (rows as unknown[])[0];
        fields = fields[0];
      }
      if (!Array.isArray(rows)) {
        const h = rows as mysql.ResultSetHeader;
        const extra = h.insertId ? ` · insertId ${h.insertId}` : '';
        return { columns: [], rows: [], affectedRows: h.affectedRows, message: `${h.affectedRows} row(s) affected${extra}`, durationMs };
      }
      const f = (fields as mysql.FieldPacket[]) ?? [];
      return {
        columns: f.map((x) => ({ name: x.name, type: TYPE_NAMES.get(x.type ?? -1) })),
        rows: (rows as unknown[][]).map((r) => r.map(toCell)),
        durationMs,
      };
    } finally {
      c.release();
    }
  }

  protected async transaction(database: string | undefined, statements: Exec[]): Promise<number> {
    const c = await this.pool!.getConnection();
    let total = 0;
    try {
      if (database) await c.query(`USE ${this.quote(database)}`);
      await c.beginTransaction();
      for (const s of statements) {
        const [r] = await c.query(s.sql, s.params);
        total += (r as mysql.ResultSetHeader).affectedRows ?? 0;
      }
      await c.commit();
      return total;
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async databases(): Promise<string[]> {
    const rows = await this.q<{ Database: string }>('SHOW DATABASES');
    return rows.map((r) => r.Database).filter((d) => this.config.showSystem || !SYSTEM_DBS.has(d.toLowerCase()));
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const dbs = await this.databases();
      return dbs.map((d) => this.node('database', d, { database: d, icon: 'database', tags: 'database sql', expanded: d === this.config.database }));
    }
    const db = n.database!;
    if (n.kind === 'database') {
      return [
        this.node('folder', 'Tables', { database: db, ref: 'tables', icon: 'folder-library', tags: 'folder' }),
        this.node('folder', 'Views', { database: db, ref: 'views', icon: 'folder-library', tags: 'folder' }),
        this.node('folder', 'Routines', { database: db, ref: 'routines', icon: 'folder-library', tags: 'folder' }),
      ];
    }
    if (n.kind === 'folder' && (n.ref === 'tables' || n.ref === 'views')) {
      const isTable = n.ref === 'tables';
      const rows = await this.q<{ name: string; est: number | null; comment: string }>(
        `SELECT table_name AS name, table_rows AS est, table_comment AS comment FROM information_schema.tables
         WHERE table_schema = ? AND table_type ${isTable ? "= 'BASE TABLE'" : "= 'VIEW'"} ORDER BY table_name`,
        [db],
      );
      return rows.map((r) =>
        this.node(isTable ? 'table' : 'view', r.name, {
          database: db,
          table: r.name,
          icon: isTable ? 'table' : 'eye',
          description: isTable && r.est != null ? `~${formatCount(Number(r.est))} rows` : undefined,
          tooltip: r.comment || undefined,
          tags: `${isTable ? 'table' : 'view'} sql`,
        }),
      );
    }
    if (n.kind === 'folder' && n.ref === 'routines') {
      const rows = await this.q<{ name: string; type: string }>(
        'SELECT routine_name AS name, routine_type AS type FROM information_schema.routines WHERE routine_schema = ? ORDER BY 1',
        [db],
      );
      return rows.map((r) =>
        this.node('routine', r.name, {
          database: db,
          table: r.name,
          ref: r.type,
          description: r.type.toLowerCase(),
          icon: r.type === 'PROCEDURE' ? 'symbol-event' : 'symbol-method',
          leaf: true,
          tags: 'routine sql',
        }),
      );
    }
    if (n.kind === 'table' || n.kind === 'view') {
      const cols = await this.columns({ database: db, table: n.table! });
      return cols.map((c) =>
        this.node('column', c.name, {
          database: db,
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
    const rows = await this.q<{ name: string; type: string; nullable: string; def: string | null; ckey: string; comment: string; extra: string }>(
      `SELECT column_name AS name, column_type AS type, is_nullable AS nullable, column_default AS def, column_key AS ckey,
              column_comment AS comment, extra FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [t.database ?? this.config.database, t.table],
    );
    return rows.map((r) => ({
      name: r.name,
      type: r.extra ? `${r.type} ${r.extra}` : r.type,
      nullable: r.nullable === 'YES',
      defaultValue: r.def,
      pk: r.ckey === 'PRI',
      comment: r.comment || undefined,
    }));
  }

  async objects(database?: string, _schema?: string, limit: number | null = 5000): Promise<{ name: string }[]> {
    return this.q<{ name: string }>(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY 1 ${limit === null ? '' : `LIMIT ${limit}`}`, [
      database ?? this.config.database ?? '',
    ]);
  }

  async ddl(t: TableRef, kind: string): Promise<string> {
    if (kind === 'routine') {
      const rows = await this.q<Record<string, string>>(`SHOW CREATE ${t.schema ?? 'PROCEDURE'} ${this.qualified(t)}`);
      const r = rows[0] ?? {};
      return r['Create Procedure'] ?? r['Create Function'] ?? '';
    }
    const rows = await this.q<Record<string, string>>(`SHOW CREATE ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualified(t)}`);
    const r = rows[0] ?? {};
    return (r['Create Table'] ?? r['Create View'] ?? '') + ';';
  }
}
