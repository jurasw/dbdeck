import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { D1Driver } from '../src/drivers/d1';
import { loadSchemaDiagram } from '../src/schema-diagram';
import { ConnectionConfig } from '../src/types';

async function withD1(fn: (driver: D1Driver, requests: { sql: string; params: unknown[] }[]) => Promise<void>, options: Partial<ConnectionConfig> = {}) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));
    CREATE VIEW names AS SELECT name FROM users;
    INSERT INTO users VALUES (1, 'Jurek'), (2, 'Ala');`);
  const requests: { sql: string; params: unknown[] }[] = [];
  const server = createServer((req, res) => {
    assert.equal(req.url, '/accounts/account/d1/database/database-uuid/raw');
    assert.equal(req.headers.authorization, 'Bearer secret');
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const query = JSON.parse(body);
      requests.push(query);
      try {
        const stmt = db.prepare(query.sql);
        const columns = stmt.columns();
        stmt.setReturnArrays(true);
        const rows = columns.length ? stmt.all(...query.params) : [];
        const changes = columns.length ? 0 : stmt.run(...query.params).changes;
        res.end(JSON.stringify({ success: true, result: [{ success: true, results: { columns: columns.map((c: { name: string }) => c.name), rows }, meta: { changes } }] }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, errors: [{ message: (error as Error).message }] }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const driver = new D1Driver(
    { id: 'd1', name: 'shop', type: 'd1', accountId: 'account', database: 'database-uuid', apiKey: 'secret', ...options },
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  try {
    await driver.connect();
    await fn(driver, requests);
  } finally {
    await driver.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
}

test('D1 browses SQLite metadata, pages, searches, DDL and foreign key diagrams through REST', () =>
  withD1(async (driver) => {
    const [database] = await driver.children();
    assert.deepEqual([database.label, database.database], ['shop', 'main']);
    const [tables, views] = await driver.children(database);
    assert.deepEqual(
      (await driver.children(tables)).map((n) => n.label),
      ['orders', 'users'],
    );
    assert.deepEqual(
      (await driver.children(views)).map((n) => n.label),
      ['names'],
    );
    const ref = { database: 'database-uuid', table: 'users' };
    assert.deepEqual(
      (await driver.columns(ref)).map((c) => [c.name, c.pk]),
      [
        ['id', true],
        ['name', false],
      ],
    );
    assert.deepEqual((await driver.page(ref, { limit: 1, offset: 1 })).rows, [[2, 'Ala']]);
    assert.equal(await driver.count(ref, undefined, 'jUr'), 1);
    assert.deepEqual((await driver.searchValues(ref, 'jUr', () => false)).matches, [{ column: 'name', value: 'Jurek' }]);
    assert.match(await driver.ddl(ref, 'table'), /CREATE TABLE users/);
    const diagram = await loadSchemaDiagram(driver, 'database-uuid');
    assert.deepEqual(
      diagram.relations.map((r) => [r.sourceColumn, r.targetColumn]),
      [['user_id', 'id']],
    );
    assert.equal(driver.editable, false);
    await assert.rejects(driver.apply(ref, { inserts: [{ id: 3 }], updates: [], deletes: [] }), /read-only/);
  }));

test('D1 binds DML values, preserves duplicate result columns and exposes API errors', () =>
  withD1(async (driver, requests) => {
    const result = await driver.run('INSERT INTO users VALUES (?, ?);', undefined, [3, "O'Neil"]);
    assert.equal(result.affectedRows, 1);
    assert.deepEqual(requests.at(-1)?.params, [3, "O'Neil"]);
    const duplicate = await driver.run('SELECT id AS same, name AS same FROM users WHERE id = ?', undefined, [3]);
    assert.deepEqual(
      duplicate.columns.map((c) => c.name),
      ['same', 'same'],
    );
    assert.deepEqual(duplicate.rows, [[3, "O'Neil"]]);
    await assert.rejects(driver.run('SELECT * FROM missing'), /no such table/);
    const count = requests.length;
    await assert.rejects(driver.run('SELECT 1; DELETE FROM users'), /exactly one/);
    assert.equal(requests.length, count);
  }));

test('D1 read-only mode blocks writes including WITH and prevents execution after a write plan', () =>
  withD1(
    async (driver, requests) => {
      await assert.rejects(driver.run('DELETE FROM users'), /read-only/);
      await assert.rejects(driver.run('WITH x AS (SELECT 1) DELETE FROM users'), /not read-only/);
      assert.ok(requests.at(-1)?.sql.startsWith('EXPLAIN WITH'));
      await assert.rejects(driver.runReadOnly("WITH x AS (SELECT 1) UPDATE users SET name = 'changed'"), /not read-only/);
      assert.deepEqual((await driver.runReadOnly('SELECT name FROM users ORDER BY id')).rows, [['Jurek'], ['Ala']]);
      assert.equal(await driver.count({ table: 'users' }), 2);
    },
    { readonly: true },
  ));

test('D1 validates required connection credentials before issuing a request', async () => {
  for (const field of ['accountId', 'database', 'apiKey'] as const) {
    const driver = new D1Driver({ id: 'd1', name: 'shop', type: 'd1', accountId: 'account', database: 'db', apiKey: 'secret', [field]: '' });
    await assert.rejects(driver.connect(), /Enter/);
  }
});
