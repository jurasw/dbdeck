import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mssql from 'mssql';
import { MssqlDriver } from '../src/drivers/mssql';
import { loadSchemaDiagram } from '../src/schema-diagram';
import { splitSql } from '../src/sqlSplit';

function fixture(fail = false) {
  const events: string[] = [];
  const statements: { sql: string; params: Record<string, unknown> }[] = [];
  const options: mssql.config[] = [];
  class Request {
    params: Record<string, unknown> = {};
    input(name: string, value: unknown) {
      this.params[name] = value;
      return this;
    }
    async query(sql: string) {
      statements.push({ sql, params: this.params });
      if (fail && sql.startsWith('INSERT')) throw new Error('constraint violation');
      const rows = sql.includes('FROM sys.columns c JOIN sys.types')
        ? [
            ['id', 'int', false, null, true, true, false, null, '1', '1'],
            ['name', 'nvarchar(100)', true, null, false, false, false, null, null, null],
          ]
        : /^SELECT/i.test(sql)
          ? [[1, 'Ala']]
          : [];
      const fields = rows[0]?.map((_, index) => String(index)) ?? [];
      const recordset = Object.assign(
        rows.map((row) => Object.fromEntries(fields.map((name, i) => [name, row[i]]))),
        { columns: Object.fromEntries(fields.map((name, index) => [name, { name, index, type: { name: 'Int' }, nullable: true }])) },
      );
      return { recordsets: rows.length ? [recordset] : [], rowsAffected: [1] };
    }
  }
  class ConnectionPool {
    constructor(o: mssql.config) {
      options.push(o);
    }
    on() {}
    async connect() {
      return this;
    }
    async close() {
      events.push('close');
    }
    request() {
      return new Request();
    }
  }
  class Transaction {
    async begin() {
      events.push('begin');
    }
    async commit() {
      events.push('commit');
    }
    async rollback() {
      events.push('rollback');
    }
  }
  const driver = new MssqlDriver({ id: 'm', name: 'SQL Server', type: 'mssql', database: 'shop', user: 'sa', password: 'test' }, {
    ConnectionPool,
    Request,
    Transaction,
  } as unknown as typeof mssql);
  return { driver, events, statements, options };
}

test('MSSQL pages use schemas, escaped identifiers, OFFSET/FETCH and Unicode literals', async () => {
  const f = fixture();
  await f.driver.connect();
  assert.equal(f.options[0].options!.encrypt, true);
  assert.equal(f.options[0].options!.trustServerCertificate, false);
  const ref = { database: 'shop', schema: 'sales', table: 'items]old' };
  assert.equal(f.driver.selectSql(ref, { limit: 25, offset: 50 }), 'SELECT * FROM [sales].[items]]old] ORDER BY (SELECT NULL) OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY');
  assert.equal(f.driver.literal("O'Neil\\"), "N'O''Neil\\'");
  assert.equal(f.driver.literal(true), '1');
  assert.match(f.driver.selectSql(ref, { limit: 1, offset: 0, where: "name = 'ORDER BY'" }), /ORDER BY \(SELECT NULL\) OFFSET/);
  assert.match(f.driver.searchWhere([{ name: 'name' }], undefined, 'Ąla')!, /CHARINDEX.*N'Ąla'/);
  const cols = await f.driver.columns(ref);
  assert.equal(cols[0].generated, true);
  await f.driver.page(ref, { limit: 2, offset: 0 });
  assert.match(f.statements.at(-1)!.sql, /ORDER BY \[id\] OFFSET 0 ROWS FETCH NEXT 2 ROWS ONLY/);
  assert.deepEqual(
    splitSql("SELECT [semi;]]colon], 'C:\\'; SELECT 2;", 'mssql').map((s) => s.text),
    ["SELECT [semi;]]colon], 'C:\\'", 'SELECT 2'],
  );
  await f.driver.close();
  assert.deepEqual(f.events, ['close']);
});

test('MSSQL stages edits atomically, excludes generated inserts and rejects generated updates', async () => {
  const f = fixture();
  await f.driver.apply({ schema: 'dbo', table: 'items' }, { updates: [{ key: { id: 1 }, values: { name: 'Ala' } }], inserts: [{ id: 90, name: 'Jurek' }], deletes: [] });
  assert.deepEqual(f.events, ['begin', 'commit']);
  assert.deepEqual(f.statements.find((s) => s.sql.startsWith('UPDATE'))!.params, { p1: 'Ala', p2: 1 });
  assert.equal(f.statements.at(-1)!.sql, 'INSERT INTO [dbo].[items] ([name]) VALUES (@p1)');
  await assert.rejects(f.driver.apply({ table: 'items' }, { updates: [{ key: { id: 1 }, values: { id: 2 } }], inserts: [], deletes: [] }), /Generated/);
  const failed = fixture(true);
  await assert.rejects(
    failed.driver.apply({ table: 'items' }, { updates: [{ key: { id: 1 }, values: { name: 'new' } }], inserts: [{ name: null }], deletes: [] }),
    /constraint violation/,
  );
  assert.deepEqual(failed.events, ['begin', 'rollback']);
  await f.driver.close();
  await failed.driver.close();
});

test('MSSQL read-only execution rejects writes, CTE writes, SELECT INTO and multiple statements', async () => {
  const f = fixture();
  for (const sql of [
    'DELETE FROM items',
    'SELECT 1 INTO new_table',
    'WITH x AS (SELECT 1 AS id) DELETE FROM items',
    'SELECT 1; UPDATE items SET name = 1',
    'SELECT 1 UPDATE items SET name = 1',
  ])
    await assert.rejects(f.driver.runReadOnly(sql), /read-only|exactly one/);
  const before = f.statements.length;
  assert.deepEqual((await f.driver.runReadOnly("SELECT 'DELETE INTO; UPDATE' AS [drop;] -- INSERT\n")).rows, [[1, 'Ala']]);
  assert.equal(f.statements.length, before + 1);
  await f.driver.close();
});

test('MSSQL integration: browsing, identity edits, rollback, search, DDL, diagrams and read-only queries', { skip: process.env.DBDECK_MSSQL_INTEGRATION !== '1' }, async () => {
  const cfg = { id: 'm', name: 'SQL Server', type: 'mssql' as const, host: '127.0.0.1', port: 11433, user: 'sa', password: 'dbdeckTest123!', database: 'master', ssl: false };
  const driver = new MssqlDriver(cfg);
  await driver.connect();
  const name = `dbdeck_${Date.now()}`;
  const ref = { database: 'master', schema: 'dbo', table: name };
  try {
    await driver.run(`CREATE TABLE [dbo].[${name}] (id int IDENTITY PRIMARY KEY, name nvarchar(100) NOT NULL, parent_id int REFERENCES [dbo].[${name}](id))`);
    await driver.apply(ref, { inserts: [{ name: 'Ąla' }, { name: 'Jurek', parent_id: 1 }], updates: [], deletes: [] });
    assert.equal((await driver.page(ref, { limit: 1, offset: 1 })).rows[0][1], 'Jurek');
    assert.equal(await driver.count(ref, undefined, 'Ąla'), 1);
    assert.ok((await driver.searchValues(ref, 'Jurek', () => false)).matches.some((m) => m.value === 'Jurek'));
    assert.match(await driver.ddl(ref, 'table'), /IDENTITY\(1,1\)/);
    assert.ok((await loadSchemaDiagram(driver, 'master', 'dbo')).relations.some((r) => r.sourceColumn === 'parent_id'));
    await assert.rejects(driver.apply(ref, { updates: [{ key: { id: 1 }, values: { name: 'changed' } }], inserts: [{ name: null }], deletes: [] }));
    assert.equal((await driver.run(`SELECT name FROM [dbo].[${name}] WHERE id = 1`)).rows[0][0], 'Ąla');
    await assert.rejects(driver.runReadOnly(`SELECT * INTO copy FROM [dbo].[${name}]`), /read-only/);
    const ro = new MssqlDriver({ ...cfg, readonly: true });
    try {
      await ro.connect();
      await assert.rejects(ro.run(`DELETE FROM [dbo].[${name}]`), /read-only/);
    } finally {
      await ro.close();
    }
  } finally {
    await driver.run(`DROP TABLE [dbo].[${name}]`).catch(() => undefined);
    await driver.close();
  }
});
