import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDriver } from '../src/drivers/sqlite';
import { loadSchemaDiagram, tableId } from '../src/schema-diagram';
import { splitSql } from '../src/sqlSplit';
import type { ConnectionConfig } from '../src/types';

function supported(): boolean {
  try {
    const mod = require('node:sqlite');
    return typeof mod.StatementSync?.prototype.setReturnArrays === 'function';
  } catch {
    return false;
  }
}

const skip = supported() ? false : 'node:sqlite with setReturnArrays needs Node 22.16 or later';

async function withDatabase(fn: (driver: SqliteDriver, file: string) => Promise<void>, config: Partial<ConnectionConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dbdeck-sqlite-'));
  const file = join(dir, 'shop.db');
  const { DatabaseSync } = require('node:sqlite');
  const setup = new DatabaseSync(file);
  setup.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, big INTEGER, data BLOB);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users, total REAL);
    CREATE VIEW totals AS SELECT user_id, sum(total) AS total FROM orders GROUP BY user_id;
    CREATE INDEX orders_user ON orders(user_id);
    INSERT INTO users VALUES (1, 'Jurek', 9007199254740993, x'cafe'), (2, 'Ala', 5, NULL);
    INSERT INTO orders VALUES (10, 1, 12.5), (11, 1, 3);
  `);
  setup.close();
  const driver = new SqliteDriver({ id: 'c', name: 'shop', type: 'sqlite', database: file, ...config });
  try {
    await driver.connect();
    await fn(driver, file);
  } finally {
    await driver.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('SQLite lists the file, tables, views and columns', { skip }, () =>
  withDatabase(async (driver) => {
    const [db] = await driver.children();
    assert.equal(db.label, 'shop.db');
    assert.equal(db.database, 'main');
    const [tables, views] = await driver.children(db);
    assert.deepEqual(
      (await driver.children(tables)).map((n) => n.label),
      ['orders', 'users'],
    );
    assert.deepEqual(
      (await driver.children(views)).map((n) => n.label),
      ['totals'],
    );
    const columns = await driver.columns({ database: 'main', table: 'users' });
    assert.deepEqual(
      columns.map((c) => [c.name, c.type, c.pk, c.nullable]),
      [
        ['id', 'integer', true, true],
        ['name', 'text', false, false],
        ['big', 'integer', false, true],
        ['data', 'blob', false, true],
      ],
    );
  }),
);

test('SQLite pages, searches and keeps large integers exact', { skip }, () =>
  withDatabase(async (driver) => {
    const page = await driver.page({ database: 'main', table: 'users' }, { limit: 10, offset: 0 });
    assert.deepEqual(page.rows, [
      [1, 'Jurek', '9007199254740993', '0xcafe'],
      [2, 'Ala', 5, null],
    ]);
    assert.equal(page.columns[0].pk, true);
    const found = await driver.page({ database: 'main', table: 'users' }, { limit: 10, offset: 0, search: 'JUR' });
    assert.deepEqual(
      found.rows.map((r) => r[1]),
      ['Jurek'],
    );
    assert.equal(await driver.count({ database: 'main', table: 'users' }, undefined, 'ala'), 1);
    const values = await driver.searchValues({ database: 'main', table: 'users' }, 'ure', () => false);
    assert.deepEqual(values.matches, [{ column: 'name', value: 'Jurek' }]);
  }),
);

test('SQLite applies staged edits in one transaction', { skip }, () =>
  withDatabase(async (driver) => {
    const ref = { database: 'main', table: 'users' };
    const changed = await driver.apply(ref, {
      updates: [{ key: { id: 1 }, values: { name: 'Ola' } }],
      inserts: [{ id: 3, name: 'Ewa', big: true }],
      deletes: [{ id: 2 }],
    });
    assert.equal(changed, 3);
    assert.deepEqual((await driver.run('SELECT id, name, big FROM users ORDER BY id')).rows, [
      [1, 'Ola', '9007199254740993'],
      [3, 'Ewa', 1],
    ]);
    await assert.rejects(driver.apply(ref, { updates: [], inserts: [], deletes: [{ id: 1 }] }), /FOREIGN KEY/);
    await assert.rejects(
      driver.apply(ref, {
        updates: [],
        inserts: [
          { id: 4, name: 'Zoe' },
          { id: 3, name: 'dup' },
        ],
        deletes: [],
      }),
      /UNIQUE/,
    );
    assert.equal(await driver.count(ref), 2);
  }),
);

test('SQLite reports affected rows for writes', { skip }, () =>
  withDatabase(async (driver) => {
    const result = await driver.run("UPDATE users SET name = upper(name) WHERE name <> ''");
    assert.equal(result.affectedRows, 2);
    assert.deepEqual(result.columns, []);
  }),
);

test('SQLite read-only queries cannot write', { skip }, () =>
  withDatabase(async (driver) => {
    const result = await driver.runReadOnly('SELECT count(*) AS n FROM orders');
    assert.deepEqual(result.rows, [[2]]);
    await assert.rejects(driver.runReadOnly('WITH x AS (SELECT 1) DELETE FROM orders'), /readonly|read-only/i);
    assert.equal(await driver.count({ database: 'main', table: 'orders' }), 2);
  }),
);

test('SQLite read-only connections reject edits', { skip }, () =>
  withDatabase(
    async (driver) => {
      await assert.rejects(driver.run('DELETE FROM orders'), /readonly/i);
      await assert.rejects(driver.apply({ database: 'main', table: 'orders' }, { updates: [], inserts: [], deletes: [{ id: 10 }] }), /read-only/);
    },
    { readonly: true },
  ),
);

test('SQLite DDL includes indexes', { skip }, () =>
  withDatabase(async (driver) => {
    const ddl = await driver.ddl({ database: 'main', table: 'orders' }, 'table');
    assert.match(ddl, /^CREATE TABLE orders/);
    assert.match(ddl, /CREATE INDEX orders_user ON orders\(user_id\);$/);
  }),
);

test('SQLite schema diagram links foreign keys to the primary key', { skip }, () =>
  withDatabase(async (driver) => {
    const diagram = await loadSchemaDiagram(driver, 'main');
    assert.deepEqual(
      diagram.relations.map((r) => [r.source, r.sourceColumn, r.target, r.targetColumn]),
      [[tableId(undefined, 'orders'), 'user_id', tableId(undefined, 'users'), 'id']],
    );
  }),
);

test('SQLite rejects a missing file instead of creating one', { skip }, async () => {
  const driver = new SqliteDriver({ id: 'x', name: 'x', type: 'sqlite', database: join(tmpdir(), 'dbdeck-missing', 'nope.db') });
  await assert.rejects(driver.connect(), /File not found/);
});

test('SQLite trigger bodies stay in one statement', () => {
  const statements = splitSql(
    `CREATE TRIGGER audit AFTER INSERT ON users BEGIN
  INSERT INTO log VALUES (new.id);
  UPDATE stats SET n = n + 1;
END;
SELECT 'a\\'; SELECT 2;`,
    'sqlite',
  );
  assert.deepEqual(
    statements.map((s) => s.text.split('\n')[0]),
    ['CREATE TRIGGER audit AFTER INSERT ON users BEGIN', "SELECT 'a\\'", 'SELECT 2'],
  );
});
