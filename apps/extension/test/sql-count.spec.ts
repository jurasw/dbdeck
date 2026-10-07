import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqlDriver } from '../src/drivers/sql';

function driver() {
  const d = Object.create(SqlDriver.prototype) as SqlDriver & { run: (sql: string) => Promise<unknown> };
  Object.assign(d, { dialect: 'postgres', quote: (name: string) => `"${name}"` });
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  d.run = (sql: string) => {
    const table = /"(\w+)"$/.exec(sql)![1];
    started.push(table);
    return new Promise((resolve) => finish.set(table, () => resolve({ columns: [], rows: [[table.length]], durationMs: 1 })));
  };
  return { d, started, finish: (table: string) => finish.get(table)!() };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('slow counts leave pool connections free and the newest waiting count runs next', async () => {
  const { d, started, finish } = driver();
  const counts = ['a', 'bb', 'ccc', 'dddd'].map((table) => d.count({ table }));
  await tick();
  assert.deepEqual(started, ['a', 'bb']);
  finish('a');
  await tick();
  assert.deepEqual(started, ['a', 'bb', 'dddd']);
  finish('bb');
  finish('dddd');
  await tick();
  assert.deepEqual(started, ['a', 'bb', 'dddd', 'ccc']);
  finish('ccc');
  assert.deepEqual(await Promise.all(counts), [1, 2, 3, 4]);
});

test('a failed count releases its slot', async () => {
  const { d, started, finish } = driver();
  const run = d.run;
  d.run = async () => {
    throw new Error('Query failed');
  };
  await assert.rejects(d.count({ table: 'x' }), /Query failed/);
  await assert.rejects(d.count({ table: 'y' }), /Query failed/);
  d.run = run;
  const counts = [d.count({ table: 'a' }), d.count({ table: 'bb' })];
  await tick();
  assert.deepEqual(started, ['a', 'bb']);
  finish('a');
  finish('bb');
  assert.deepEqual(await Promise.all(counts), [1, 2]);
});
