import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatMessage, ChatReply, chatSystemPrompt, databaseTools, runChatTurn, ToolEvent } from '../src/ai-chat';
import { chatReply } from '../src/ai-client';
import { aiDatabase } from '../src/ai-database';
import { ElasticDriver } from '../src/drivers/elastic';
import { MongoDriver } from '../src/drivers/mongo';
import { SqlDriver } from '../src/drivers/sql';

function stubDriver(log: string[] = []) {
  const driver = Object.assign(Object.create(SqlDriver.prototype), {
    dialect: 'postgres',
    objects: async (database?: string, schema?: string) => {
      log.push(`objects ${database} ${schema}`);
      return [
        { name: 'users', schema: 'public' },
        { name: 'orders', schema: 'shop' },
      ];
    },
    columns: async (t: { database?: string; schema?: string; table: string }) => {
      log.push(`columns ${t.database} ${t.schema} ${t.table}`);
      return t.table === 'users' ? [{ name: 'id', type: 'int4', pk: true, nullable: false }] : [];
    },
    runReadOnly: async (sql: string, database?: string) => {
      log.push(`query ${database} ${sql}`);
      if (/delete/i.test(sql)) throw new Error('Only read-only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN statements can run here.');
      return { columns: [{ name: 'n' }, { name: 'note' }], rows: Array.from({ length: 150 }, (_, i) => [i, 'x'.repeat(400)]), durationMs: 3 };
    },
  });
  return aiDatabase(driver, 'app')!;
}

const call = (name: string, args: unknown, id = name) => ({ id, name, arguments: JSON.stringify(args) });

test('chat tools read schema and hide queries until the user allows them', async () => {
  const log: string[] = [];
  const events: ToolEvent[] = [];
  let allowed = false;
  const tools = databaseTools(
    stubDriver(log),
    {},
    () => allowed,
    (e) => events.push(e),
  );
  assert.deepEqual(
    tools.tools().map((t) => t.name),
    ['list_tables', 'describe_table'],
  );
  assert.deepEqual(JSON.parse(await tools.execute(call('list_tables', {}))), { tables: ['public.users', 'shop.orders'], truncated: false });
  assert.deepEqual(JSON.parse(await tools.execute(call('describe_table', { table: 'public.users' }))), [{ name: 'id', type: 'int4', primaryKey: true, nullable: false }]);
  assert.match(await tools.execute(call('describe_table', { table: 'missing' })), /^Error: Table missing was not found/);
  assert.match(await tools.execute(call('run_query', { sql: 'SELECT 1' })), /^Error: Running queries is turned off/);
  assert.match(await tools.execute({ id: 'x', name: 'describe_table', arguments: '{bad' }), /^Error:/);
  assert.deepEqual(log, ['objects app undefined', 'columns app public users', 'columns app undefined missing']);
  allowed = true;
  assert.deepEqual(
    tools.tools().map((t) => t.name),
    ['list_tables', 'describe_table', 'run_query'],
  );
  const result = JSON.parse(await tools.execute(call('run_query', { sql: 'SELECT n FROM t' })));
  assert.equal(result.rows.length, 50);
  assert.equal(result.rowCount, 150);
  assert.equal(result.truncated, true);
  assert.equal(result.rows[0][1].length, 301);
  assert.match(await tools.execute(call('run_query', { sql: 'DELETE FROM t' })), /^Error: Only read-only/);
  assert.deepEqual(
    events.map((e) => [e.label, e.result?.rows.length, e.error !== undefined]),
    [
      ['Listed 2 tables', undefined, false],
      ['Read the columns of public.users', undefined, false],
      ['Ran a read-only query', 150, false],
      ['Query failed', undefined, true],
    ],
  );
});

test('chat tools use the opened schema without a schema prefix', async () => {
  const log: string[] = [];
  const tools = databaseTools(
    stubDriver(log),
    { schema: 'public' },
    () => false,
    () => undefined,
  );
  assert.deepEqual(JSON.parse(await tools.execute(call('list_tables', {}))).tables, ['users', 'orders']);
  await tools.execute(call('describe_table', { table: 'users' }));
  assert.deepEqual(log, ['objects app public', 'columns app public users']);
});

test('a chat turn runs tools until the model answers', async () => {
  const history: ChatMessage[] = [{ role: 'user', content: 'How many users?' }];
  const replies: ChatReply[] = [
    { content: '', calls: [call('list_tables', {}, 'a'), call('describe_table', { table: 'users' }, 'b')] },
    { content: 'There is **1** user table.', calls: [] },
  ];
  const seen: number[] = [];
  const answer = await runChatTurn(
    async (h) => {
      seen.push(h.length);
      return replies.shift()!;
    },
    history,
    async (c) => `result ${c.id}`,
    new AbortController().signal,
  );
  assert.equal(answer, 'There is **1** user table.');
  assert.deepEqual(seen, [1, 4]);
  assert.deepEqual(
    history.map((m) => m.role),
    ['user', 'assistant', 'tool', 'tool', 'assistant'],
  );
  await assert.rejects(
    runChatTurn(
      async () => ({ content: '', calls: [call('list_tables', {})] }),
      [],
      async () => '',
      new AbortController().signal,
      3,
    ),
    /too many steps/,
  );
});

test('the system prompt says whether the assistant may run queries', () => {
  const context = { connection: 'Prod', database: 'app', dialect: 'mysql', family: 'sql' as const };
  assert.match(chatSystemPrompt(context, true), /Call run_query/);
  assert.match(chatSystemPrompt(context, false), /You cannot run queries/);
  assert.match(chatSystemPrompt(context, false), /mysql database \(connection "Prod", database "app"\)/);
});

const history: ChatMessage[] = [
  { role: 'user', content: 'Count users' },
  { role: 'assistant', content: 'Checking.', calls: [call('run_query', { sql: 'SELECT count(*) FROM users' }, 'c1')] },
  { role: 'tool', callId: 'c1', name: 'run_query', content: '{"rows":[[3]]}' },
];
const tools = [{ name: 'run_query', description: 'Run SQL', parameters: { type: 'object', properties: { sql: { type: 'string' } } } }];

test('OpenAI chat sends function calls and reads streamed tool calls', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.instructions, 'system');
    assert.equal(body.store, false);
    assert.deepEqual(body.tools, [{ type: 'function', name: 'run_query', description: 'Run SQL', parameters: tools[0].parameters, strict: false }]);
    assert.deepEqual(body.input, [
      { role: 'user', content: 'Count users' },
      { role: 'assistant', content: 'Checking.' },
      { type: 'function_call', call_id: 'c1', name: 'run_query', arguments: '{"sql":"SELECT count(*) FROM users"}' },
      { type: 'function_call_output', call_id: 'c1', output: '{"rows":[[3]]}' },
    ]);
    const frames = [
      {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          content: [
            { type: 'output_text', text: 'There are ' },
            { type: 'output_text', text: '3 users.' },
          ],
        },
      },
      { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c2', name: 'run_query', arguments: '{"sql":"SELECT 1"}' } },
      { type: 'response.completed', response: { status: 'completed' } },
    ];
    return new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(''));
  };
  try {
    assert.deepEqual(await chatReply({ provider: 'openai', baseUrl: '', model: 'gpt' }, 'key', 'system', history, tools), {
      content: 'There are 3 users.',
      calls: [{ id: 'c2', name: 'run_query', arguments: '{"sql":"SELECT 1"}' }],
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('compatible providers get chat completions with tool messages', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'Count users' },
      { role: 'assistant', content: 'Checking.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_query', arguments: '{"sql":"SELECT count(*) FROM users"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"rows":[[3]]}' },
    ]);
    assert.equal(body.tools[0].function.name, 'run_query');
    return Response.json({ choices: [{ message: { content: null, tool_calls: [{ function: { name: 'run_query', arguments: { sql: 'SELECT 2' } } }] } }] });
  };
  try {
    assert.deepEqual(await chatReply({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama' }, undefined, 'system', history, tools), {
      content: '',
      calls: [{ id: 'call_0', name: 'run_query', arguments: '{"sql":"SELECT 2"}' }],
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('Claude chat groups tool results and returns tool use blocks', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.system, 'system');
    assert.deepEqual(body.tools, [{ name: 'run_query', description: 'Run SQL', input_schema: tools[0].parameters }]);
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'Count users' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'c1', name: 'run_query', input: { sql: 'SELECT count(*) FROM users' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"rows":[[3]]}' }] },
    ]);
    return Response.json({
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'One more.' },
        { type: 'tool_use', id: 't2', name: 'run_query', input: { sql: 'SELECT 1' } },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  };
  try {
    assert.deepEqual(await chatReply({ provider: 'anthropic', baseUrl: '', model: 'claude-opus-5-5' }, 'user-key', 'system', history, tools), {
      content: 'One more.',
      calls: [{ id: 't2', name: 'run_query', arguments: '{"sql":"SELECT 1"}' }],
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('MongoDB chat runs only read-only finds and aggregations', async () => {
  const calls: unknown[][] = [];
  const driver = Object.create(MongoDriver.prototype);
  driver.collections = async () => ['orders'];
  driver.db = (name: string) => ({
    collection: (coll: string) => ({
      find: (filter: unknown, options: unknown) => ({ toArray: async () => (calls.push([name, coll, 'find', filter, options]), [{ _id: 1, status: 'active' }]) }),
      aggregate: (pipeline: unknown) => ({ toArray: async () => (calls.push([name, coll, 'aggregate', pipeline]), [{ _id: 'active', n: 2 }]) }),
    }),
  });
  const db = aiDatabase(driver, 'shop')!;
  const events: ToolEvent[] = [];
  const tools = databaseTools(
    db,
    {},
    () => true,
    (e) => events.push(e),
  );
  assert.deepEqual(Object.keys((tools.tools()[2].parameters as { properties: object }).properties), ['query']);
  assert.deepEqual(JSON.parse(await tools.execute(call('list_tables', {}))).tables, ['orders']);
  const found = JSON.parse(await tools.execute(call('run_query', { query: '{"collection": "orders", "filter": {"status": "active"}, "limit": 5}' })));
  assert.deepEqual(found.rows, [[1, 'active']]);
  await tools.execute(call('run_query', { query: '{"collection": "orders", "pipeline": [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]}' }));
  assert.match(await tools.execute(call('run_query', { query: '{"collection": "orders", "pipeline": [{"$facet": {"a": [{"$out": "copy"}]}}]}' })), /^Error: \$out and \$merge/);
  assert.match(await tools.execute(call('run_query', { query: 'db.orders.drop()' })), /^Error:/);
  assert.deepEqual(calls, [
    ['shop', 'orders', 'find', { status: 'active' }, { projection: undefined, sort: undefined, limit: 5, maxTimeMS: 30000 }],
    ['shop', 'orders', 'aggregate', [{ $group: { _id: '$status', n: { $sum: 1 } } }, { $limit: 100 }]],
  ]);
  const prompt = chatSystemPrompt({ connection: 'Prod', database: 'shop', table: 'orders', dialect: 'mongodb', family: 'mongo' }, true);
  assert.match(prompt, /collection orders open/);
  assert.match(prompt, /```javascript/);
});

test('Elasticsearch chat runs only read-only requests', async () => {
  const requests: string[] = [];
  const driver = Object.create(ElasticDriver.prototype);
  driver.request = async (method: string, path: string) => {
    requests.push(`${method} ${path}`);
    return { status: 200, durationMs: 1, body: { hits: { hits: [{ _id: 'a', _index: 'logs', _score: 1, _source: { level: 'error' } }] } } };
  };
  const db = aiDatabase(driver, undefined)!;
  assert.deepEqual((await db.runReadOnly('POST /logs/_search\n{ "size": 1 }')).rows, [['a', 'logs', 1, 'error']]);
  await db.runReadOnly('GET /_cat/indices');
  await assert.rejects(db.runReadOnly('DELETE /logs'), /Only GET requests/);
  await assert.rejects(db.runReadOnly('POST /logs/_update_by_query\n{}'), /Only GET requests/);
  await assert.rejects(db.runReadOnly('POST /logs/_mapping\n{}'), /Only GET requests/);
  await assert.rejects(db.runReadOnly('GET /a/_search\n\nGET /b/_search'), /exactly one request/);
  assert.deepEqual(requests, ['POST /logs/_search', 'GET /_cat/indices']);
});
