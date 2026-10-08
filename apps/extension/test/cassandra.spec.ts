import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSql } from '../src/sqlSplit';
import { Client, types } from 'cassandra-driver';
import { CassandraDriver, cassandraCell, cassandraType } from '../src/drivers/cassandra';

test('Cassandra values preserve bigint, decimal, UUID and collections', () => {
  assert.equal(cassandraCell(types.Long.fromString('9007199254740993')), '9007199254740993');
  assert.equal(cassandraCell(types.BigDecimal.fromString('1.234567890123456789')), '1.234567890123456789');
  assert.deepEqual(cassandraCell(new Map([['a', types.Long.fromString('42')]])), { a: '42' });
  assert.deepEqual(cassandraCell(new Set(['a', 'b'])), ['a', 'b']);
  assert.deepEqual(cassandraCell(new types.Tuple('x', types.Long.fromString('9007199254740993'))), ['x', '9007199254740993']);
  assert.equal(cassandraType({ code: types.dataTypes.map, info: [{ code: types.dataTypes.text }, { code: types.dataTypes.int }] }), 'map<text, int>');
});

test('Cassandra pages use scoped native cursors without OFFSET or a whole-result LIMIT', async () => {
  const calls: { sql: string; options?: unknown }[] = [];
  let closed = false;
  const driver = new CassandraDriver({ id: 'c', name: 'Cassandra', type: 'cassandra', localDatacenter: 'dc1' }, (options) => {
    assert.equal(options!.localDataCenter, 'dc1');
    return {
      connect: async () => undefined,
      shutdown: async () => {
        closed = true;
      },
      execute: async (sql: string, _params: unknown[], options?: { pageState?: string }) => {
        calls.push({ sql, options });
        if (sql.includes('system_schema.keyspaces')) return { rows: [{ keyspace_name: 'system' }, { keyspace_name: 'shop' }] };
        if (sql.includes('system_schema.columns')) return { rows: [{ column_name: 'id', type: 'int', kind: 'partition_key', position: 0 }] };
        return { rows: [{ id: options?.pageState ? 2 : 1 }], columns: [{ name: 'id', type: { code: types.dataTypes.int } }], pageState: options?.pageState ? null : 'next' };
      },
    } as unknown as Client;
  });
  await driver.connect();
  assert.deepEqual(await driver.databases(), ['shop']);
  const t = { database: 'shop', table: 'items' };
  assert.equal(driver.selectSql(t, { limit: 1, offset: 0 }), 'SELECT * FROM "shop"."items" LIMIT 1');
  assert.deepEqual((await driver.page(t, { limit: 1, offset: 0 })).rows, [[1]]);
  assert.deepEqual((await driver.page(t, { limit: 1, offset: 1 })).rows, [[2]]);
  const pageCalls = calls.filter((c) => c.sql.includes('FROM "shop"'));
  assert.equal(pageCalls[0].sql, 'SELECT * FROM "shop"."items"');
  assert.equal((pageCalls[1].options as { pageState: string }).pageState, 'next');
  await assert.rejects(driver.runReadOnly('BEGIN BATCH INSERT INTO items (id) VALUES (3); APPLY BATCH'), /read-only|exactly/);
  await assert.rejects(driver.page(t, { limit: 1, offset: 0, search: 'abc' }), /full-text/);
  await driver.close();
  assert.equal(closed, true);
});

test('Cassandra integration: keyspaces, composite keys, static columns, paging, CQL and DDL', { skip: process.env.DBDECK_CASSANDRA_INTEGRATION !== '1' }, async () => {
  const cfg = {
    id: 'c',
    name: 'Local',
    type: 'cassandra' as const,
    host: process.env.DBDECK_CASSANDRA_HOST || '127.0.0.1',
    port: Number(process.env.DBDECK_CASSANDRA_PORT || 19042),
    localDatacenter: 'datacenter1',
  };
  const driver = new CassandraDriver(cfg);
  await driver.connect();
  const db = `dbdeck_${Date.now()}`;
  try {
    await driver.run(`CREATE KEYSPACE "${db}" WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`);
    await driver.run(
      `CREATE TABLE "${db}".items (tenant int, id int, name text, big bigint, note text static, tags frozen<set<text>>, PRIMARY KEY ((tenant), id)) WITH CLUSTERING ORDER BY (id DESC)`,
    );
    for (let i = 1; i <= 3; i++)
      await driver.run(`INSERT INTO "${db}".items (tenant, id, name, big) VALUES (1, ?, ?, ?)`, undefined, [i, `user${i}`, types.Long.fromString('9007199254740993')]);
    assert.ok((await driver.databases()).includes(db));
    assert.equal((await driver.run('SELECT COUNT(*) FROM items', db)).rows[0][0], '3');
    assert.equal((await driver.objects(db))[0].name, 'items');
    const t = { database: db, table: 'items' };
    const keys = (await driver.columns(t)).filter((c) => c.pk);
    assert.equal(keys.length, 2);
    for (let offset = 0; offset < 3; offset++) {
      const page = await driver.page(t, { limit: 1, offset, where: 'tenant = 1' });
      assert.equal(page.rows.length, 1);
      assert.equal(page.rows[0][page.columns.findIndex((c) => c.name === 'id')], 3 - offset);
      assert.equal(page.rows[0][page.columns.findIndex((c) => c.name === 'big')], '9007199254740993');
    }
    assert.equal(await driver.count(t, 'tenant = 1'), 3);
    const ddl = await driver.ddl(t);
    assert.match(ddl, /PRIMARY KEY \(\("tenant"\), "id"\)/);
    assert.match(ddl, /"note" text STATIC/);
    assert.match(ddl, /frozen<set<text>>/);
    assert.match(ddl, /"id" DESC/);
    const ro = new CassandraDriver({ ...cfg, readonly: true });
    try {
      await ro.connect();
      await assert.rejects(ro.run(`DELETE FROM "${db}".items WHERE tenant = 1`), /read-only/);
      assert.equal((await ro.runReadOnly(`SELECT COUNT(*) FROM "${db}".items`)).rows[0][0], '3');
    } finally {
      await ro.close();
    }
  } finally {
    await driver.run(`DROP KEYSPACE "${db}"`).catch(() => undefined);
    await driver.close();
  }
});

test('CQL batches keep inner statements together and preserve dollar-quoted literals', () => {
  const batch = "BEGIN UNLOGGED BATCH INSERT INTO items (id, name) VALUES (1, $$a;b$$); UPDATE items SET name = 'x' WHERE id = 1; APPLY BATCH";
  assert.deepEqual(
    splitSql(`SELECT * FROM items; ${batch}; SELECT * FROM items;`, 'cassandra').map((s) => s.text),
    ['SELECT * FROM items', batch, 'SELECT * FROM items'],
  );
});
