import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snowflakeAccount, SnowflakeDriver, snowflakeValue } from '../src/drivers/snowflake';
import { ConnectionConfig } from '../src/types';

type Handler = (req: IncomingMessage, url: URL, body: Record<string, unknown> | undefined, res: ServerResponse) => void;

async function serve(handler: Handler) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => handler(req, new URL(req.url!, 'http://localhost'), body ? JSON.parse(body) : undefined, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const result = (names: string[], data: (string | null)[][], extra: Record<string, unknown> = {}) => ({
  statementHandle: 'h1',
  resultSetMetaData: { numRows: data.length, rowType: names.map((name) => ({ name, type: 'text' })) },
  data,
  ...extra,
});

const config = (patch: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  id: 'c1',
  name: 'sf',
  type: 'snowflake',
  host: 'myorg-acct',
  user: 'jane',
  password: 'pat-secret',
  warehouse: 'WH',
  role: 'ANALYST',
  ...patch,
});

test('Snowflake account accepts identifiers and full URLs', () => {
  assert.equal(snowflakeAccount('https://myorg-acct.snowflakecomputing.com/console'), 'myorg-acct');
  assert.equal(snowflakeAccount(' xy12345.eu-central-1 '), 'xy12345.eu-central-1');
  assert.throws(() => snowflakeAccount(''), /account identifier/);
});

test('Snowflake values are converted from the SQL API wire format', () => {
  assert.equal(snowflakeValue({ name: 'n', type: 'fixed', scale: 0 }, '42'), 42);
  assert.equal(snowflakeValue({ name: 'n', type: 'fixed', scale: 0 }, '12345678901234567890'), '12345678901234567890');
  assert.equal(snowflakeValue({ name: 'b', type: 'boolean' }, 'true'), true);
  assert.equal(snowflakeValue({ name: 'd', type: 'date' }, '20454'), '2026-01-01');
  assert.equal(snowflakeValue({ name: 't', type: 'timestamp_ntz' }, '1767225600.500000000'), '2026-01-01 00:00:00.5');
  assert.equal(snowflakeValue({ name: 't', type: 'timestamp_tz' }, '1767225600.000000000 1560'), '2026-01-01 02:00:00 +02:00');
  assert.deepEqual(snowflakeValue({ name: 'v', type: 'variant' }, '{"a":[1]}'), { a: [1] });
  assert.equal(snowflakeValue({ name: 'x', type: 'text' }, null), null);
});

test('Snowflake runs statements with a token, polls async results and reads every partition', async () => {
  const posted: Record<string, unknown>[] = [];
  const s = await serve((req, url, body, res) => {
    assert.equal(req.headers.authorization, 'Bearer pat-secret');
    assert.equal(req.headers['x-snowflake-authorization-token-type'], 'PROGRAMMATIC_ACCESS_TOKEN');
    if (req.method === 'POST') {
      posted.push(body!);
      if (body!.statement === 'SHOW TERSE DATABASES LIMIT 1') return json(res, 200, result(['name'], [['SHOP']]));
      return json(res, 202, { statementHandle: 'h1', message: 'Asynchronous execution in progress.' });
    }
    assert.equal(url.pathname, '/api/v2/statements/h1');
    if (url.searchParams.get('partition') === '1') return json(res, 200, { data: [['2', 'b']] });
    json(res, 200, {
      statementHandle: 'h1',
      resultSetMetaData: {
        numRows: 2,
        rowType: [
          { name: 'ID', type: 'fixed', scale: 0 },
          { name: 'NAME', type: 'text' },
        ],
        partitionInfo: [{ rowCount: 1 }, { rowCount: 1 }],
      },
      data: [['1', 'a']],
    });
  });
  try {
    const d = new SnowflakeDriver(config({ database: 'SHOP' }), s.base);
    await d.connect();
    const r = await d.run('SELECT id, name FROM items');
    assert.deepEqual(
      r.columns.map((c) => [c.name, c.type]),
      [
        ['ID', 'NUMBER'],
        ['NAME', 'VARCHAR'],
      ],
    );
    assert.deepEqual(r.rows, [
      [1, 'a'],
      [2, 'b'],
    ]);
    assert.deepEqual([posted[1].database, posted[1].warehouse, posted[1].role, posted[1].timeout], ['SHOP', 'WH', 'ANALYST', 0]);
    await d.runReadOnly('SELECT 1');
    assert.equal(posted[2].timeout, 30);
  } finally {
    s.close();
  }
});

test('Snowflake key pair auth signs a JWT with the public key fingerprint', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const file = join(mkdtempSync(join(tmpdir(), 'dbdeck-sf-')), 'rsa_key.p8');
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' }));
  const fingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
  const s = await serve((req, _url, _body, res) => {
    assert.equal(req.headers['x-snowflake-authorization-token-type'], 'KEYPAIR_JWT');
    const [head, claims, signature] = String(req.headers.authorization).replace('Bearer ', '').split('.');
    assert.ok(createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, signature, 'base64url'));
    const c = JSON.parse(Buffer.from(claims, 'base64url').toString());
    assert.equal(c.iss, `XY12345.JANE.SHA256:${fingerprint}`);
    assert.equal(c.sub, 'XY12345.JANE');
    json(res, 200, result(['name'], [['SHOP']]));
  });
  try {
    const d = new SnowflakeDriver(config({ host: 'xy12345.eu-central-1', authMethod: 'keyPair', keyFile: file, password: 'pw' }), s.base);
    await d.connect();
  } finally {
    s.close();
  }
});

test('Snowflake tree hides system schemas, reads columns and reports SQL errors', async () => {
  const s = await serve((_req, _url, body, res) => {
    const sql = String(body?.statement);
    if (sql.startsWith('SHOW TERSE DATABASES')) return json(res, 200, result(['name'], [['SHOP'], ['SNOWFLAKE']]));
    if (sql === 'SHOW TERSE SCHEMAS IN DATABASE "SHOP"') return json(res, 200, result(['name'], [['INFORMATION_SCHEMA'], ['PUBLIC']]));
    if (sql === 'SHOW TABLES IN SCHEMA "SHOP"."PUBLIC"') return json(res, 200, result(['name', 'rows', 'comment'], [['ORDERS', '1200', '']]));
    if (sql === 'DESCRIBE TABLE "SHOP"."PUBLIC"."ORDERS"')
      return json(
        res,
        200,
        result(
          ['name', 'type', 'null?', 'default', 'primary key', 'comment'],
          [
            ['ID', 'NUMBER(38,0)', 'N', null, 'Y', null],
            ['NOTE', 'VARCHAR(16777216)', 'Y', null, 'N', 'free text'],
          ],
        ),
      );
    if (sql.startsWith('SELECT COUNT(*)')) {
      assert.equal(
        sql,
        `SELECT COUNT(*) FROM "SHOP"."PUBLIC"."ORDERS" WHERE CONTAINS(LOWER(TO_VARCHAR("ID")), LOWER('o''k')) OR CONTAINS(LOWER(TO_VARCHAR("NOTE")), LOWER('o''k'))`,
      );
      return json(res, 422, { code: '002003', message: "SQL compilation error: Object 'ORDERS' does not exist or not authorized." });
    }
    json(res, 422, { message: `unexpected ${sql}` });
  });
  try {
    const d = new SnowflakeDriver(config(), s.base);
    assert.deepEqual(await d.databases(), ['SHOP']);
    const schemas = await d.children({ connId: 'c1', kind: 'database', label: 'SHOP', database: 'SHOP' });
    assert.deepEqual(
      schemas.map((n) => n.label),
      ['PUBLIC'],
    );
    const tables = await d.children({ connId: 'c1', kind: 'folder', label: 'Tables', database: 'SHOP', schema: 'PUBLIC', ref: 'tables' });
    assert.deepEqual(
      tables.map((n) => [n.kind, n.label, n.description]),
      [['table', 'ORDERS', '1.2k rows']],
    );
    const ref = { database: 'SHOP', schema: 'PUBLIC', table: 'ORDERS' };
    assert.deepEqual(await d.columns(ref), [
      { name: 'ID', type: 'NUMBER(38,0)', nullable: false, pk: true, defaultValue: null, comment: undefined },
      { name: 'NOTE', type: 'VARCHAR(16777216)', nullable: true, pk: false, defaultValue: null, comment: 'free text' },
    ]);
    await assert.rejects(d.count(ref, undefined, "o'k"), /Object 'ORDERS' does not exist/);
  } finally {
    s.close();
  }
});
