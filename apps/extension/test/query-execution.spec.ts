import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeQueries, parseEsRequests } from '../src/query-execution';
import { SqlDriver } from '../src/drivers/sql';
import { ConnectionConfig, QueryResult } from '../src/types';

class QueryDriver extends SqlDriver {
  readonly dialect = 'postgres' as const;
  calls: string[] = [];
  protected async disconnect(): Promise<void> {}
  async connect(): Promise<void> {}
  quote(name: string): string {
    return `"${name}"`;
  }
  protected param(): string {
    return '$1';
  }
  async columns() {
    return [];
  }
  async ddl() {
    return '';
  }
  async objects() {
    return [];
  }
  async databases() {
    return ['test'];
  }
  protected async transaction() {
    return 0;
  }
  async run(sql: string): Promise<QueryResult> {
    this.calls.push(sql);
    if (sql === 'broken') throw new Error('Query failed');
    return { columns: [{ name: 'id' }], rows: [[1], [2], [3]], durationMs: 1 };
  }
  protected async readOnly(sql: string): Promise<QueryResult> {
    return this.run(sql);
  }
}

const config: ConnectionConfig = { id: 'test', name: 'Test', type: 'postgres' };

test('shared query execution preserves statement order, limits results and stops SQL on error', async () => {
  const driver = new QueryDriver(config);
  const results = await executeQueries(driver, ['first', 'broken', 'never'], 'test', 2);
  assert.deepEqual(driver.calls, ['first', 'broken']);
  assert.deepEqual(results[0].rows, [[1], [2]]);
  assert.equal(results[0].truncated, true);
  assert.equal(results[0].sql, 'first');
  assert.equal(results[1].error, 'Query failed');
  assert.equal(results[1].sql, 'broken');
});

test('desktop read-only query execution rejects writes before invoking the driver', async () => {
  const driver = new QueryDriver({ ...config, readonly: true });
  const results = await executeQueries(driver, ['DELETE FROM users', 'SELECT 1'], 'test', 5000, true);
  assert.deepEqual(driver.calls, []);
  assert.match(results[0].error!, /read-only/);
  const allowed = await executeQueries(driver, ['SELECT 1'], 'test', 5000, true);
  assert.equal(allowed[0].error, undefined);
  assert.deepEqual(driver.calls, ['SELECT 1']);
});

test('shared Elasticsearch parser keeps request ranges and JSON bodies', () => {
  const text = '# demo\nGET /orders/_search\n{ "size": 2 }\n\nGET /_cluster/health\n';
  const requests = parseEsRequests(text);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].path, '/orders/_search');
  assert.deepEqual(JSON.parse(requests[0].body), { size: 2 });
  assert.equal(text.slice(requests[1].start).trim(), requests[1].text);
});
