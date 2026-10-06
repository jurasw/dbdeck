import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PostgresDriver } from '../src/drivers/postgres';
import { McpBackend, queryOutput, startMcpServer } from '../src/mcp-server';
import { QueryResult } from '../src/types';

function backend(calls: string[]): McpBackend {
  return {
    connections: () => [{ id: 'c1', name: 'Local', type: 'postgres', database: 'app' }],
    databases: async () => ['app'],
    tables: async () => [{ name: 'users', schema: 'public' }],
    columns: async () => [{ name: 'id', type: 'int4', pk: true }],
    query: async (_id, _db, sql) => {
      calls.push(`query:${sql}`);
      return { columns: [{ name: 'id' }], rows: [[1], [2], [3]], durationMs: 1 };
    },
    open: async (_id, _db, sql) => {
      calls.push(`open:${sql}`);
    },
    maxRows: () => 2,
  };
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text: string }[])[0].text;
}

test('MCP server lets authorized agents inspect schema, read rows and open changes for review', async () => {
  const calls: string[] = [];
  const server = await startMcpServer(backend(calls), { token: 'secret', port: 0, version: 'test' });
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer secret' } } }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['describe_table', 'list_connections', 'list_databases', 'list_tables', 'open_query', 'run_query']);
    assert.equal(tools.find((t) => t.name === 'run_query')?.annotations?.readOnlyHint, true);
    assert.deepEqual(JSON.parse(text(await client.callTool({ name: 'list_connections', arguments: {} }))), [{ id: 'c1', name: 'Local', type: 'postgres', database: 'app' }]);
    const rows = JSON.parse(text(await client.callTool({ name: 'run_query', arguments: { connectionId: 'c1', database: 'app', sql: 'SELECT id FROM users' } })));
    assert.deepEqual(rows.rows, [[1], [2]]);
    assert.equal(rows.truncated, true);
    await client.callTool({ name: 'open_query', arguments: { connectionId: 'c1', database: 'app', sql: 'DELETE FROM users' } });
    assert.deepEqual(calls, ['query:SELECT id FROM users', 'open:DELETE FROM users']);
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP server rejects missing tokens and foreign Host headers', async () => {
  const server = await startMcpServer(backend([]), { token: 'secret', port: 0, version: 'test' });
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  try {
    const url = `http://127.0.0.1:${server.port}/mcp`;
    assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Authorization: 'Bearer wrong' }, body })).status, 401);
    const http = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(url, { method: 'POST', headers: { ...headers, Authorization: 'Bearer secret', host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0));
      req.on('error', reject);
      req.end(body);
    });
    assert.equal(status, 403);
  } finally {
    await server.close();
  }
});

test('MCP query output shrinks oversized results', () => {
  const result: QueryResult = { columns: [{ name: 'blob' }], rows: Array.from({ length: 100 }, () => ['x'.repeat(10000)]), durationMs: 1 };
  const output = JSON.parse(queryOutput(result, 100));
  assert.ok(output.rows.length < 100);
  assert.equal(output.truncated, true);
});

test('read-only queries accept one reading statement and reject writes', async () => {
  const seen: string[] = [];
  class Driver extends PostgresDriver {
    protected async readOnly(sql: string): Promise<QueryResult> {
      seen.push(sql);
      return { columns: [], rows: [], durationMs: 0 };
    }
  }
  const driver = new Driver({ id: 'c1', name: 'Local', type: 'postgres' });
  await driver.runReadOnly('-- latest users\nWITH u AS (SELECT 1) SELECT * FROM u;', 'app');
  await driver.runReadOnly('EXPLAIN SELECT 1');
  assert.deepEqual(seen, ['-- latest users\nWITH u AS (SELECT 1) SELECT * FROM u', 'EXPLAIN SELECT 1']);
  await assert.rejects(driver.runReadOnly('DELETE FROM users'), /read-only/);
  await assert.rejects(driver.runReadOnly('SELECT 1; DROP TABLE users'), /exactly one/);
  await assert.rejects(driver.runReadOnly("SELECT * FROM users INTO OUTFILE '/tmp/x'"), /read-only/);
});
