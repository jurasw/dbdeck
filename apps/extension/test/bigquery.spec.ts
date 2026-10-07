import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BigQueryDriver } from '../src/drivers/bigquery';
import { GoogleCredentials } from '../src/google-credentials';
import { ConnectionConfig } from '../src/types';

type Handler = (req: IncomingMessage, url: URL, body: string, res: ServerResponse) => void;

async function serve(handler: Handler) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => handler(req, new URL(req.url!, 'http://localhost'), body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const config = (patch: Partial<ConnectionConfig> = {}): ConnectionConfig => ({ id: 'c1', name: 'bq', type: 'bigquery', project: 'proj', ...patch });
const credentials = { token: async () => 'access', projectId: () => undefined };

const ordersSchema = {
  fields: [
    { name: 'id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'created', type: 'TIMESTAMP' },
    { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    {
      name: 'customer',
      type: 'RECORD',
      fields: [
        { name: 'name', type: 'STRING' },
        { name: 'vip', type: 'BOOLEAN' },
      ],
    },
  ],
};

const ordersRow = { f: [{ v: '7' }, { v: '1767225600000000' }, { v: [{ v: 'a' }, { v: 'b' }] }, { v: { f: [{ v: 'Ann' }, { v: 'true' }] } }] };

test('service account credentials sign a JWT and cache the access token', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let calls = 0;
  const s = await serve((_req, _url, body, res) => {
    calls++;
    const form = new URLSearchParams(body);
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [head, claims, signature] = form.get('assertion')!.split('.');
    assert.ok(createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, signature, 'base64url'));
    const c = JSON.parse(Buffer.from(claims, 'base64url').toString());
    assert.equal(c.iss, 'robot@proj.iam.gserviceaccount.com');
    assert.equal(c.scope, 'https://www.googleapis.com/auth/bigquery');
    json(res, 200, { access_token: 'sa-token', expires_in: 3600 });
  });
  try {
    const file = join(mkdtempSync(join(tmpdir(), 'dbdeck-bq-')), 'key.json');
    writeFileSync(
      file,
      JSON.stringify({
        type: 'service_account',
        project_id: 'from-key',
        client_email: 'robot@proj.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        token_uri: `${s.base}/token`,
      }),
    );
    const creds = new GoogleCredentials(file, 'https://www.googleapis.com/auth/bigquery');
    assert.equal(creds.projectId(), 'from-key');
    assert.equal(await creds.token(), 'sa-token');
    assert.equal(await creds.token(), 'sa-token');
    assert.equal(calls, 1);
  } finally {
    s.close();
  }
});

test('missing credentials explain how to sign in', async () => {
  const creds = new GoogleCredentials(join(tmpdir(), 'dbdeck-missing.json'), 'scope');
  await assert.rejects(creds.token(), /Cannot read the credentials file/);
});

test('BigQuery lists datasets and tables and browses a table without running a query', async () => {
  const s = await serve((req, url, _body, res) => {
    assert.equal(req.headers.authorization, 'Bearer access');
    const path = url.pathname.replace('/projects/proj', '');
    if (path === '/datasets' && url.searchParams.get('maxResults') === '1') return json(res, 200, {});
    if (path === '/datasets') return json(res, 200, { datasets: [{ datasetReference: { datasetId: 'shop' } }, { datasetReference: { datasetId: 'analytics' } }] });
    if (path === '/datasets/shop/tables')
      return json(res, 200, {
        tables: [
          { tableReference: { tableId: 'orders' }, type: 'TABLE' },
          { tableReference: { tableId: 'daily' }, type: 'VIEW' },
        ],
      });
    if (path === '/datasets/shop/tables/orders')
      return json(res, 200, { type: 'TABLE', numRows: '42', schema: ordersSchema, tableConstraints: { primaryKey: { columns: ['id'] } } });
    if (path === '/datasets/shop/tables/orders/data') {
      assert.equal(url.searchParams.get('startIndex'), '100');
      assert.equal(url.searchParams.get('maxResults'), '25');
      return json(res, 200, { rows: [ordersRow] });
    }
    assert.fail(`unexpected ${req.method} ${url.pathname}`);
  });
  try {
    const d = new BigQueryDriver(config(), credentials, s.base);
    await d.connect();
    assert.deepEqual(await d.databases(), ['analytics', 'shop']);
    const tables = await d.children({ connId: 'c1', kind: 'database', label: 'shop', database: 'shop' });
    assert.deepEqual(
      tables.map((t) => [t.kind, t.label]),
      [
        ['view', 'daily'],
        ['table', 'orders'],
      ],
    );
    const ref = { database: 'shop', table: 'orders' };
    const page = await d.page(ref, { limit: 25, offset: 100 });
    assert.deepEqual(
      page.columns.map((c) => [c.name, c.type, c.pk]),
      [
        ['id', 'INTEGER', true],
        ['created', 'TIMESTAMP', false],
        ['tags', 'ARRAY<STRING>', false],
        ['customer', 'STRUCT<name STRING, vip BOOLEAN>', false],
      ],
    );
    assert.deepEqual(page.rows, [[7, '2026-01-01T00:00:00.000Z', ['a', 'b'], { name: 'Ann', vip: true }]]);
    assert.equal(await d.count(ref), 42);
  } finally {
    s.close();
  }
});

test('BigQuery queries wait for the job, read every page and cap read-only bytes', async () => {
  const posted: Record<string, unknown>[] = [];
  const s = await serve((req, url, body, res) => {
    const path = url.pathname.replace('/projects/proj', '');
    if (path === '/datasets') return json(res, 200, {});
    if (req.method === 'POST' && path === '/queries') {
      posted.push(JSON.parse(body));
      return json(res, 200, { jobComplete: false, jobReference: { jobId: 'j1', location: 'EU' } });
    }
    if (path === '/queries/j1') {
      assert.equal(url.searchParams.get('location'), 'EU');
      if (!url.searchParams.get('pageToken'))
        return json(res, 200, {
          jobComplete: true,
          jobReference: { jobId: 'j1' },
          schema: { fields: [{ name: 'n', type: 'INTEGER' }] },
          rows: [{ f: [{ v: '1' }] }],
          totalRows: '2',
          pageToken: 'p2',
          totalBytesProcessed: '2048',
        });
      return json(res, 200, { jobComplete: true, jobReference: { jobId: 'j1' }, rows: [{ f: [{ v: '2' }] }] });
    }
    assert.fail(`unexpected ${req.method} ${url.pathname}`);
  });
  try {
    const d = new BigQueryDriver(config({ database: 'shop' }), credentials, s.base);
    await d.connect();
    const r = await d.run('SELECT n FROM numbers');
    assert.deepEqual(r.rows, [[1], [2]]);
    assert.equal(r.message, '2.0 KB processed');
    assert.deepEqual(posted[0].defaultDataset, { projectId: 'proj', datasetId: 'shop' });
    assert.equal(posted[0].useLegacySql, false);
    assert.equal(posted[0].maximumBytesBilled, undefined);
    await d.runReadOnly('SELECT n FROM numbers');
    assert.equal(posted[1].maximumBytesBilled, String(10 * 1024 ** 3));
    assert.equal(posted[1].jobTimeoutMs, 30000);
    await assert.rejects(d.runReadOnly('DELETE FROM numbers WHERE true'), /Only read-only/);
  } finally {
    s.close();
  }
});

test('BigQuery filters use CONTAINS_SUBSTR, escape string literals and surface API errors', async () => {
  const posted: string[] = [];
  const s = await serve((req, url, body, res) => {
    if (url.pathname.endsWith('/datasets')) return json(res, 200, {});
    if (url.pathname.endsWith('/tables/orders')) return json(res, 200, { type: 'TABLE', schema: ordersSchema });
    if (req.method === 'POST') {
      posted.push(JSON.parse(body).query);
      if (posted.at(-1)!.includes('INFORMATION_SCHEMA')) return json(res, 400, { error: { message: 'Access Denied: INFORMATION_SCHEMA' } });
      return json(res, 200, { jobComplete: true, jobReference: { jobId: 'j' }, schema: { fields: [{ name: 'f0_', type: 'INTEGER' }] }, rows: [{ f: [{ v: '3' }] }] });
    }
    return json(res, 400, { error: { message: `unexpected ${url.pathname}` } });
  });
  try {
    const d = new BigQueryDriver(config(), credentials, s.base);
    await d.connect();
    assert.equal(await d.count({ database: 'shop', table: 'orders' }, undefined, "it's"), 3);
    assert.match(posted[0], /^SELECT COUNT\(\*\) FROM `shop`\.`orders` WHERE CONTAINS_SUBSTR\(`id`, 'it\\'s'\)/);
    await assert.rejects(d.ddl({ database: 'shop', table: 'orders' }), /^Error: Access Denied: INFORMATION_SCHEMA$/);
  } finally {
    s.close();
  }
});
