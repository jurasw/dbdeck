import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDriver } from '../src/drivers/postgres';
import { MysqlDriver } from '../src/drivers/mysql';
import { ClickHouseDriver } from '../src/drivers/clickhouse';
import { MongoDriver } from '../src/drivers/mongo';
import { searchDatabaseValues } from '../src/database-search';

// Run against disposable test/docker-compose.yml services only.
const skip = process.env.DBDECK_OMNISEARCH_INTEGRATION !== '1';
for (const type of ['postgres', 'mysql', 'clickhouse'] as const) {
  test(`${type}: Omnisearch finds values beyond page one and opens matching records`, { skip }, async () => {
    const Driver = type === 'postgres' ? PostgresDriver : type === 'mysql' ? MysqlDriver : ClickHouseDriver;
    const database = type === 'clickhouse' ? 'default' : 'shop';
    const driver = new Driver({
      id: 'integration',
      name: 'test',
      type,
      host: '127.0.0.1',
      port: type === 'postgres' ? 15433 : type === 'mysql' ? 13306 : 18123,
      user: type === 'postgres' ? 'postgres' : type === 'mysql' ? 'root' : 'default',
      password: 'dbdeck',
      database,
    });
    const ref = { database, schema: type === 'postgres' ? 'public' : undefined, table: `omnisearch_${Date.now()}` };
    const target = driver.qualified(ref);
    await driver.connect();
    try {
      await driver.run(
        `CREATE TABLE ${target} (id ${type === 'clickhouse' ? 'Int32' : 'INTEGER'}, name ${type === 'clickhouse' ? 'String' : 'TEXT'})${type === 'clickhouse' ? ' ENGINE = Memory' : ''}`,
        database,
      );
      const literal = "a%_'\\tail";
      await driver.run(
        `INSERT INTO ${target} VALUES ${Array.from({ length: 160 }, (_, i) => `(${i}, ${driver.literal(i === 151 ? 'Jurek' : i === 152 ? literal : 'other')})`).join(', ')}`,
        database,
      );
      const result = await driver.searchValues(ref, 'JUREK', () => false);
      assert.deepEqual(result, { matches: [{ column: 'name', value: 'Jurek' }], limited: false });
      assert.deepEqual((await driver.searchValues(ref, literal, () => false)).matches, [{ column: 'name', value: literal }]);
      assert.deepEqual((await driver.searchValues(ref, '151', () => false)).matches, [{ column: 'id', value: '151' }]);
      assert.equal((await driver.searchValues(ref, 'other', () => false)).limited, true);
      assert.deepEqual(
        (await driver.page(ref, { limit: 100, offset: 0, search: 'JUREK' })).rows.map((row) => String(row[1])),
        ['Jurek'],
      );
      const nodes: string[] = [];
      for await (const event of searchDatabaseValues(
        { connId: 'integration', kind: 'database', database, label: database },
        'JUREK',
        {
          children: (node) => driver.children(node),
          scan: (node, query, cancelled) => driver.searchValues({ database: node.database, schema: node.schema, table: node.table! }, query, cancelled),
        },
        () => false,
      )) {
        if (event.kind === 'match') nodes.push(event.node.table!);
        if (event.kind === 'warning') assert.fail(event.message);
      }
      assert.deepEqual(nodes, [ref.table]);
    } finally {
      await driver.run(`DROP TABLE IF EXISTS ${target}`, database);
      await driver.close();
    }
  });
}

test('MongoDB: Omnisearch scans late nested values and closes the query cursor', { skip }, async () => {
  const driver = new MongoDriver({ id: 'integration', name: 'test', type: 'mongodb', host: '127.0.0.1', port: 27018, user: 'root', password: 'dbdeck' });
  const collection = `omnisearch_${Date.now()}`;
  await driver.connect();
  try {
    await driver
      .db('shop')
      .collection(collection)
      .insertMany(Array.from({ length: 160 }, (_, i) => ({ id: i, players: [{ name: i === 151 ? 'Jurek' : 'other' }] })));
    assert.deepEqual(await driver.searchValues('shop', collection, 'JUREK', () => false), { matches: [{ column: 'players.0.name', value: 'Jurek' }], limited: false });
    assert.equal((await driver.find('shop', collection, { skip: 0, limit: 100, search: 'JUREK' })).docs.length, 1);
  } finally {
    await driver.db('shop').collection(collection).drop();
    await driver.close();
  }
});
