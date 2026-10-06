import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SqlDriver } from '../src/drivers/sql';
import { loadSchemaDiagram, tableId } from '../src/schema-diagram';

function driver(dialect: SqlDriver['dialect'], rows: unknown[][], schema?: string) {
  const calls: { database?: string; params?: unknown[] }[] = [];
  const stub = {
    dialect,
    objects: async () => [
      { name: 'users', schema },
      { name: 'orders', schema },
    ],
    columns: async () => [{ name: 'id', pk: true }, { name: 'user_id' }],
    run: async (_sql: string, database?: string, params?: unknown[]) => {
      calls.push({ database, params });
      return { rows };
    },
  } as unknown as SqlDriver;
  return { stub, calls };
}

test('loads all columns and composite PostgreSQL foreign keys within the selected schema', async () => {
  const { stub, calls } = driver(
    'postgres',
    [
      ['order_user', 'app', 'orders', 'user_id', 'app', 'users', 'id'],
      ['order_user', 'app', 'orders', 'tenant_id', 'app', 'users', 'tenant_id'],
      ['external', 'app', 'orders', 'other_id', 'other', 'users', 'id'],
    ],
    'app',
  );
  const result = await loadSchemaDiagram(stub, 'db', 'app');
  assert.equal(result.tables.length, 2);
  assert.equal(result.tables[0].columns[0].pk, true);
  assert.deepEqual(
    result.relations.map((r) => [r.source, r.target, r.sourceColumn, r.targetColumn]),
    [
      [tableId('app', 'orders'), tableId('app', 'users'), 'user_id', 'id'],
      [tableId('app', 'orders'), tableId('app', 'users'), 'tenant_id', 'tenant_id'],
    ],
  );
  assert.deepEqual(calls, [{ database: 'db', params: ['app'] }]);
});

test('maps MySQL catalog owners to table identities without confusing another database', async () => {
  const { stub, calls } = driver('mysql', [
    ['order_user', 'db', 'orders', 'user_id', 'db', 'users', 'id'],
    ['external', 'db', 'orders', 'other_id', 'other', 'users', 'id'],
  ]);
  const result = await loadSchemaDiagram(stub, 'db');
  assert.equal(result.relations.length, 1);
  assert.equal(result.relations[0].target, result.tables[0].id);
  assert.deepEqual(calls, [{ database: 'db', params: ['db'] }]);
});

test('ClickHouse shows metadata without querying unsupported foreign key catalogs', async () => {
  const { stub, calls } = driver('clickhouse', []);
  const result = await loadSchemaDiagram(stub, 'db');
  assert.equal(result.tables.length, 2);
  assert.deepEqual(result.relations, []);
  assert.deepEqual(calls, []);
});

test('metadata errors reach the caller instead of presenting an incomplete diagram', async () => {
  const { stub } = driver('postgres', []);
  stub.columns = async () => {
    throw new Error('permission denied');
  };
  await assert.rejects(loadSchemaDiagram(stub, 'db'), /permission denied/);
});

test('table identities preserve names containing punctuation', () => {
  assert.notEqual(tableId('a.b', 'c'), tableId('a', 'b.c'));
});
