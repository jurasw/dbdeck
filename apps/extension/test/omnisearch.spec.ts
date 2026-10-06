import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesValue, scanValues } from '../src/drivers/mongo';
import { SqlDriver } from '../src/drivers/sql';

test('value search traverses nested objects and arrays without matching field names', () => {
  assert.equal(matchesValue({ nested: [{ email: 'Hello@Example.com' }] }, 'EXAMPLE'), true);
  assert.equal(matchesValue({ example: null }, 'example'), false);
  assert.equal(matchesValue({ n: 123, b: true }, '23'), true);
  assert.equal(matchesValue({ text: 'a.*b' }, '.*'), true);
});

test('scan finds matches beyond the first hundred documents and pages matching records', async () => {
  async function* source() {
    for (let id = 0; id < 250; id++) yield { id, nested: { value: id >= 150 ? 'needle' : 'other' } };
  }
  const result = await scanValues(source(), 'needle', 20, 10, (doc) => doc);
  assert.equal(result.total, 100);
  assert.deepEqual(
    result.docs.map((d) => d.id),
    Array.from({ length: 10 }, (_, i) => 170 + i),
  );
});

test('SQL search applies to all columns before pagination and retains existing conditions', async () => {
  for (const dialect of ['postgres', 'mysql', 'clickhouse'] as const) {
    const driver = Object.create(SqlDriver.prototype) as SqlDriver;
    Object.defineProperty(driver, 'dialect', { value: dialect });
    driver.quote = (name) => `"${name}"`;
    driver.columns = async () => [{ name: 'id', pk: true }, { name: 'payload' }];
    const queries: string[] = [];
    driver.run = async (sql) => {
      queries.push(sql);
      return { columns: [], rows: [[4]], durationMs: 0 };
    };
    await driver.page({ table: 'items' }, { search: "a%_'b", where: 'id > 10', limit: 25, offset: 100 });
    await driver.count({ table: 'items' }, 'id > 10', "a%_'b");
    assert.ok(queries[0].includes('(id > 10) AND ('));
    assert.ok(queries[0].includes('"payload"'));
    assert.ok(queries[0].endsWith('LIMIT 25 OFFSET 100'));
    assert.ok(queries[0].includes("a%_''b"));
    assert.equal(queries[0].split(' WHERE ')[1].split(' ORDER BY ')[0].split(' LIMIT ')[0], queries[1].split(' WHERE ')[1]);
  }
});
