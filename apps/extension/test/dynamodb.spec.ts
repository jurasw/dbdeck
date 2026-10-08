import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ExecuteStatementCommand,
  ListTablesCommand,
  PutItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDbDriver, dynamoGrid } from '../src/drivers/dynamodb';

test('DynamoDB grids preserve large numbers, sparse fields, nested maps, sets and binary values', () => {
  const grid = dynamoGrid(
    [
      { id: { N: '9007199254740993' }, nested: { M: { decimal: { N: '1.234567890123456789' } } }, tags: { SS: ['a', 'b'] }, blob: { B: Buffer.from('hello') } },
      { id: { N: '2' }, extra: { BOOL: true } },
    ],
    [{ name: 'id', pk: true }],
  );
  assert.deepEqual(
    grid.columns.map((c) => c.name),
    ['id', 'nested', 'tags', 'blob', 'extra'],
  );
  assert.equal(grid.rows[0][0], '9007199254740993');
  assert.deepEqual(grid.rows[0][1], { decimal: '1.234567890123456789' });
  assert.deepEqual(grid.rows[0][2], ['a', 'b']);
  assert.equal(grid.rows[0][3], 'aGVsbG8=');
  assert.equal(grid.rows[1][1], null);
  assert.equal(grid.rows[1][4], true);
});

function fixture() {
  const calls: unknown[] = [];
  let destroyed = false;
  const driver = new DynamoDbDriver(
    { id: 'd', name: 'AWS', type: 'dynamodb', region: 'eu-west-1', user: 'key', password: 'secret', sessionToken: 'temporary' },
    () =>
      ({
        send: async (command: unknown) => {
          calls.push(command);
          if (command instanceof ListTablesCommand) return { TableNames: ['items'] };
          if (command instanceof DescribeTableCommand)
            return { Table: { KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }], AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }] } };
          if (command instanceof ScanCommand)
            return command.input.ExclusiveStartKey ? { Items: [{ id: { S: 'second' } }] } : { Items: [{ id: { S: 'first' } }], LastEvaluatedKey: { id: { S: 'first' } } };
          if (command instanceof ExecuteStatementCommand) return command.input.NextToken ? { Items: [{ id: { S: 'filtered' } }] } : { Items: [], NextToken: 'next' };
          throw new Error('Unexpected command');
        },
        destroy: () => {
          destroyed = true;
        },
      }) as unknown as DynamoDBClient,
  );
  return { driver, calls, destroyed: () => destroyed };
}

test('DynamoDB lists tables, uses Scan cursors for browsing and NextToken for filtered PartiQL', async () => {
  const f = fixture();
  await f.driver.connect();
  assert.equal((await f.driver.children())[0].database, 'eu-west-1');
  assert.equal((await f.driver.children({ connId: 'd', kind: 'database', label: 'eu-west-1', database: 'eu-west-1' }))[0].table, 'items');
  const t = { database: 'eu-west-1', table: 'items' };
  assert.equal(f.driver.selectSql(t, { limit: 25, offset: 0 }), 'SELECT * FROM "items"');
  assert.deepEqual((await f.driver.page(t, { limit: 1, offset: 0 })).rows, [['first']]);
  assert.deepEqual((await f.driver.page(t, { limit: 1, offset: 1 })).rows, [['second']]);
  assert.deepEqual((await f.driver.page(t, { limit: 1, offset: 0, where: "id = 'filtered'" })).rows, [['filtered']]);
  const queries = f.calls.filter((c) => c instanceof ExecuteStatementCommand) as ExecuteStatementCommand[];
  assert.equal(queries[1].input.NextToken, 'next');
  assert.equal(queries[1].input.Limit, 1);
  await assert.rejects(f.driver.count(t), /exact row counts/);
  await assert.rejects(f.driver.page(t, { limit: 1, offset: 0, search: 'name' }), /full-text/);
  await assert.rejects(f.driver.runReadOnly('DELETE FROM "items"'), /read-only/);
  await assert.rejects(f.driver.apply(t, { inserts: [{ id: 'x' }], deletes: [], updates: [] }), /read-only/);
  await f.driver.close();
  assert.equal(f.destroyed(), true);
});

test('DynamoDB refuses incomplete credentials before creating a client', async () => {
  const driver = new DynamoDbDriver({ id: 'd', name: 'AWS', type: 'dynamodb', user: 'key' }, () => {
    throw new Error('Must not create client');
  });
  await assert.rejects(driver.connect(), /both AWS access/);
});

test('DynamoDB integration: item browsing, binary cursors, PartiQL writes and read-only execution', { skip: process.env.DBDECK_DYNAMODB_INTEGRATION !== '1' }, async () => {
  const cfg = {
    id: 'd',
    name: 'Local',
    type: 'dynamodb' as const,
    region: 'us-east-1',
    endpoint: process.env.DBDECK_DYNAMODB_ENDPOINT || 'http://127.0.0.1:18000',
    user: 'local',
    password: 'local',
  };
  const client = new DynamoDBClient({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.user, secretAccessKey: cfg.password },
    requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
  });
  const driver = new DynamoDbDriver(cfg);
  const table = `dbdeck_${Date.now()}`;
  await client.send(
    new CreateTableCommand({
      TableName: table,
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'B' }],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
  try {
    for (let i = 0; i < 3; i++)
      await client.send(new PutItemCommand({ TableName: table, Item: { id: { B: Buffer.from([i]) }, name: { S: `user${i}` }, big: { N: '9007199254740993' } } }));
    await driver.connect();
    const t = { table };
    const filtered = await driver.page(t, { limit: 1, offset: 0, where: `"name" = 'user1'` });
    assert.equal(filtered.rows[0][filtered.columns.findIndex((c) => c.name === 'name')], 'user1');
    const seen = new Set();
    for (let offset = 0; offset < 3; offset++) {
      const page = await driver.page(t, { limit: 1, offset });
      assert.equal(page.rows.length, 1);
      seen.add(page.rows[0][0]);
      assert.equal(page.rows[0][page.columns.findIndex((c) => c.name === 'big')], '9007199254740993');
    }
    assert.equal(seen.size, 3);
    assert.equal((await driver.page(t, { limit: 1, offset: 3 })).rows.length, 0);
    await assert.rejects(driver.runReadOnly(`SELECT * FROM "${table}" WHERE "id" = ?`));
    await driver.run(`UPDATE "${table}" SET "name" = 'updated' WHERE "id" = ?`, undefined, [Buffer.from([0])]);
    const queried = await driver.run(`SELECT * FROM "${table}" WHERE "id" = ?`, undefined, [Buffer.from([0])]);
    assert.equal(queried.rows[0][queried.columns.findIndex((c) => c.name === 'name')], 'updated');
    const ro = new DynamoDbDriver({ ...cfg, readonly: true });
    try {
      await ro.connect();
      await assert.rejects(ro.run(`DELETE FROM "${table}" WHERE "id" = ?`, undefined, [Buffer.from([0])]), /read-only/);
    } finally {
      await ro.close();
    }
  } finally {
    await driver.close();
    await client.send(new DeleteTableCommand({ TableName: table }));
    client.destroy();
  }
});
