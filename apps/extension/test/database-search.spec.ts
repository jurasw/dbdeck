import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSearchEvent, DatabaseSearchSource, searchDatabaseValues } from '../src/database-search';
import { MongoDriver, matchingValues } from '../src/drivers/mongo';
import { PostgresDriver } from '../src/drivers/postgres';
import { MysqlDriver } from '../src/drivers/mysql';
import { ClickHouseDriver } from '../src/drivers/clickhouse';
import type { DbNode } from '../src/types';

const root: DbNode = { connId: 'test', kind: 'database', label: 'game', database: 'game' };
const schema = (name: string): DbNode => ({ ...root, kind: 'schema', label: name, schema: name });
const table = (name: string, owner = 'public'): DbNode => ({ ...schema(owner), kind: 'table', label: name, table: name });
const match = { column: 'name', value: 'Jurek' };
const collect = async (events: AsyncIterable<DatabaseSearchEvent>) => {
  const result: DatabaseSearchEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
};

test('database search traverses schemas and tables, preserving the matched column and scope', async () => {
  const scanned: DbNode[] = [];
  const source: DatabaseSearchSource = {
    children: async (node) => (node.kind === 'database' ? [schema('public'), schema('archive')] : [table('players', node.schema)]),
    scan: async (node, query) => {
      assert.equal(query, 'JUREK');
      scanned.push(node);
      return { matches: [match, match, { column: 'nickname', value: 'jurek' }], limited: false };
    },
  };
  const events = await collect(searchDatabaseValues(root, ' JUREK ', source, () => false));
  assert.deepEqual(
    scanned.map((n) => n.schema),
    ['public', 'archive'],
  );
  assert.deepEqual(
    events.filter((e) => e.kind === 'match').map((e) => e.match),
    [match, { column: 'nickname', value: 'jurek' }, match, { column: 'nickname', value: 'jurek' }],
  );
  scanned.length = 0;
  await collect(searchDatabaseValues(schema('archive'), 'JUREK', source, () => false));
  assert.deepEqual(
    scanned.map((n) => n.schema),
    ['archive'],
  );
});

test('search reports inaccessible branches and tables and continues with other tables', async () => {
  const source: DatabaseSearchSource = {
    children: async (node) => {
      if (node.kind === 'database') return [schema('private'), table('broken'), table('players')];
      throw new Error('No permission');
    },
    scan: async (node) => {
      if (node.table === 'broken') throw new Error('Query timed out');
      return { matches: [match], limited: true };
    },
  };
  const events = await collect(searchDatabaseValues(root, 'JUREK', source, () => false));
  assert.equal(events.filter((e) => e.kind === 'warning').length, 2);
  assert.equal(events.filter((e) => e.kind === 'match').length, 1);
  assert.deepEqual(events.at(-1), { kind: 'done', limitedTables: 1, limitReached: false });
});

test('empty and cancelled searches do not query; cancellation discards an in-flight response', async () => {
  let cancelled = false;
  let scans = 0;
  let calls = 0;
  const source: DatabaseSearchSource = {
    children: async () => {
      calls++;
      return [table('players'), table('teams')];
    },
    scan: async () => {
      scans++;
      cancelled = true;
      return { matches: [match], limited: false };
    },
  };
  assert.deepEqual(await collect(searchDatabaseValues(root, '  ', source, () => false)), []);
  assert.deepEqual(await collect(searchDatabaseValues(root, 'JUREK', source, () => true)), []);
  assert.equal(calls, 0);
  const events = await collect(searchDatabaseValues(root, 'JUREK', source, () => cancelled));
  assert.equal(scans, 1);
  assert.equal(events.filter((e) => e.kind === 'match').length, 0);
});

test('result cap is explicit and stops further table scans', async () => {
  let scans = 0;
  const events = await collect(
    searchDatabaseValues(
      root,
      'JUREK',
      {
        children: async () => [table('players'), table('teams')],
        scan: async () => {
          scans++;
          return { matches: Array.from({ length: 201 }, (_, i) => ({ column: 'name', value: `Jurek ${i}` })), limited: false };
        },
      },
      () => false,
    ),
  );
  assert.equal(scans, 1);
  assert.equal(events.filter((e) => e.kind === 'match').length, 200);
  assert.deepEqual(events.at(-1), { kind: 'done', limitedTables: 0, limitReached: true });
});

for (const Driver of [PostgresDriver, MysqlDriver, ClickHouseDriver]) {
  test(`${Driver.name} searches every column through the bounded read-only path`, async () => {
    const driver = new Driver({ id: 'test', name: 'test', type: 'postgres' });
    driver.columns = async () => [{ name: 'name' }, { name: 'odd"`column' }];
    let sql = '';
    (driver as any).readOnly = async (query: string, database: string) => {
      sql = query;
      assert.equal(database, 'game');
      return { rows: Array.from({ length: 21 }, () => ['Jurek', null]), columns: [], durationMs: 0 };
    };
    const result = await driver.searchValues({ database: 'game', schema: 'public', table: 'players' }, "a%_'\\JUREK", () => false);
    assert.equal(result.matches.length, 20);
    assert.deepEqual(result.matches[0], match);
    assert.equal(result.limited, true);
    assert.ok(sql.includes(driver.literal("a%_'\\JUREK")));
    assert.ok(sql.includes(driver.quote('odd"`column')));
    assert.ok(sql.endsWith('LIMIT 21'));
    assert.ok(sql.includes('CASE WHEN'));
    let cancelled = false;
    driver.columns = async () => {
      cancelled = true;
      return [{ name: 'name' }];
    };
    (driver as any).readOnly = async () => assert.fail('must not run after cancellation');
    assert.deepEqual(await driver.searchValues({ table: 'players' }, 'JUREK', () => cancelled), { matches: [], limited: false });
  });
}

test('MongoDB previews nested paths, arrays and literal substrings, without matching field names', () => {
  assert.deepEqual(matchingValues({ name: 'Jurek', players: [{ nick: 'jurek' }], JUREK: null }, 'JUREK'), [match, { column: 'players.0.nick', value: 'jurek' }]);
  assert.deepEqual(matchingValues({ name: 'a.*b', n: 123 }, '.*'), [{ column: 'name', value: 'a.*b' }]);
});

test('MongoDB scans beyond the first page and closes cursors on limits and cancellation', async () => {
  const driver = new MongoDriver({ id: 'test', name: 'test', type: 'mongodb' });
  let closed = 0;
  let cancelled = false;
  let cancelNext = false;
  driver.db = (() => ({
    collection: () => ({
      find: () => ({
        maxTimeMS(ms: number) {
          assert.equal(ms, 30000);
          return this;
        },
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < 200; i++) {
            if (cancelNext) cancelled = true;
            yield { name: i < 150 ? 'other' : 'Jurek' };
          }
        },
        close: async () => {
          closed++;
        },
      }),
    }),
  })) as any;
  const result = await driver.searchValues('game', 'players', 'JUREK', () => cancelled);
  assert.equal(result.matches.length, 20);
  assert.equal(result.limited, true);
  assert.equal(closed, 1);
  cancelNext = true;
  assert.deepEqual(await driver.searchValues('game', 'players', 'JUREK', () => cancelled), { matches: [], limited: false });
  assert.equal(closed, 2);
});
