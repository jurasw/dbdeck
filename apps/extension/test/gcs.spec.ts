import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GcsDriver } from '../src/drivers/gcs';
import { gcloudLogin, listBuckets } from '../src/google-storage';
import { ConnectionConfig } from '../src/types';

type Handler = (req: IncomingMessage, url: URL, body: Buffer, res: ServerResponse) => void;

async function storage(handler: Handler) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      assert.equal(req.headers.authorization, 'Bearer access');
      handler(req, new URL(req.url!, 'http://localhost'), Buffer.concat(chunks), res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const config = (patch: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  id: 'c1',
  name: 'gcs',
  type: 's3',
  googleAuth: true,
  project: 'proj',
  googleEmail: 'ann@example.com',
  ...patch,
});

test('GCS lists project buckets, folders and objects across pages', async () => {
  const s = await storage((_req, url, _body, res) => {
    if (url.pathname === '/storage/v1/b') {
      assert.equal(url.searchParams.get('project'), 'proj');
      if (!url.searchParams.get('pageToken')) return json(res, 200, { items: [{ name: 'beta' }], nextPageToken: 'b2' });
      return json(res, 200, { items: [{ name: 'alpha' }] });
    }
    assert.equal(url.pathname, '/storage/v1/b/alpha/o');
    assert.equal(url.searchParams.get('prefix'), 'logs/');
    assert.equal(url.searchParams.get('delimiter'), '/');
    if (!url.searchParams.get('pageToken')) return json(res, 200, { prefixes: ['logs/2026/'], items: [{ name: 'logs/', size: '0' }], nextPageToken: 'p2' });
    json(res, 200, { items: [{ name: 'logs/app.log', size: '2048', updated: '2026-10-07T10:00:00Z' }] });
  });
  try {
    assert.deepEqual(await listBuckets('access', 'proj', s.base), ['alpha', 'beta']);
    const d = new GcsDriver(config(), async () => 'access', s.base);
    const buckets = await d.children();
    assert.deepEqual(
      buckets.map((b) => b.label),
      ['alpha', 'beta'],
    );
    const kids = await d.children({ ...buckets[0], kind: 's3Prefix', prefix: 'logs/' });
    assert.deepEqual(
      kids.map((k) => [k.kind, k.label, k.key ?? k.prefix]),
      [
        ['s3Prefix', '2026', 'logs/2026/'],
        ['s3Object', 'app.log', 'logs/app.log'],
      ],
    );
    assert.match(kids[1].tooltip!, /^gs:\/\/alpha\/logs\/app\.log/);
    assert.match(kids[1].tooltip!, /\nmodified \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const one = new GcsDriver(config({ database: 'only' }), async () => 'access', s.base);
    assert.deepEqual(
      (await one.children()).map((b) => b.label),
      ['only'],
    );
  } finally {
    s.close();
  }
});

test('GCS downloads, uploads with length and deletes every object under a prefix', async () => {
  const deleted: string[] = [];
  let uploaded: { name: string | null; length?: string; body: string } | undefined;
  const s = await storage((req, url, body, res) => {
    if (req.method === 'GET' && url.searchParams.get('alt') === 'media') {
      assert.equal(url.pathname, '/storage/v1/b/alpha/o/dir%2Fa%20b.txt');
      return res.end('hello');
    }
    if (req.method === 'POST') {
      assert.equal(url.pathname, '/upload/storage/v1/b/alpha/o');
      uploaded = { name: url.searchParams.get('name'), length: req.headers['content-length'], body: body.toString() };
      return json(res, 200, { name: url.searchParams.get('name') });
    }
    if (req.method === 'DELETE') {
      deleted.push(decodeURIComponent(url.pathname.split('/o/')[1]));
      res.writeHead(204);
      return res.end();
    }
    assert.equal(url.searchParams.get('delimiter'), null);
    if (!url.searchParams.get('pageToken')) return json(res, 200, { items: [{ name: 'dir/a' }, { name: 'dir/b' }], nextPageToken: 'n' });
    json(res, 200, { items: [{ name: 'dir/c' }] });
  });
  try {
    const dir = mkdtempSync(join(tmpdir(), 'dbdeck-gcs-'));
    const d = new GcsDriver(config(), async () => 'access', s.base);
    await d.download('alpha', 'dir/a b.txt', join(dir, 'out', 'file.txt'));
    assert.equal(readFileSync(join(dir, 'out', 'file.txt'), 'utf8'), 'hello');
    writeFileSync(join(dir, 'up.txt'), 'zażółć');
    await d.upload('alpha', 'dir/up.txt', join(dir, 'up.txt'));
    assert.deepEqual(uploaded, { name: 'dir/up.txt', length: String(Buffer.byteLength('zażółć')), body: 'zażółć' });
    assert.equal(await d.removePrefix('alpha', 'dir/'), 3);
    assert.deepEqual(deleted.sort(), ['dir/a', 'dir/b', 'dir/c']);
    const ro = new GcsDriver(config({ readonly: true }), async () => 'access', s.base);
    await assert.rejects(ro.upload('alpha', 'x', join(dir, 'up.txt')), /read-only/);
    await assert.rejects(ro.remove('alpha', 'x'), /read-only/);
  } finally {
    s.close();
  }
});

test('GCS errors name the signed-in account and the next step', async () => {
  const s = await storage((_req, url, _body, res) => {
    if (url.pathname.endsWith('/expired')) return json(res, 401, { error: { message: 'Invalid Credentials' } });
    if (url.pathname.endsWith('/denied')) return json(res, 403, { error: { message: 'Permission storage.buckets.get denied.' } });
    json(res, 404, { error: { message: 'Not Found' } });
  });
  try {
    const connect = (bucket: string) => new GcsDriver(config({ database: bucket }), async () => 'access', s.base).connect();
    await assert.rejects(connect('expired'), /sign-in expired.*Sign in with Google/);
    await assert.rejects(connect('denied'), /ann@example\.com has no access to bucket denied\. Permission storage\.buckets\.get denied\./);
    await assert.rejects(connect('missing'), /Bucket missing not found/);
    await assert.rejects(new GcsDriver(config({ project: undefined }), async () => 'access', s.base).connect(), /Choose a bucket/);
  } finally {
    s.close();
  }
});

test('Google sign-in runs gcloud application-default login and reports its failure', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbdeck-gcloud-'));
  const ok = join(dir, 'ok');
  writeFileSync(ok, `#!/bin/sh\necho "$@" > "${join(dir, 'args')}"\n`);
  const bad = join(dir, 'bad');
  writeFileSync(bad, '#!/bin/sh\necho "ERROR: (gcloud.auth.application-default.login) Login cancelled" >&2\nexit 1\n');
  chmodSync(ok, 0o755);
  chmodSync(bad, 0o755);
  await gcloudLogin(new AbortController().signal, ok);
  assert.equal(readFileSync(join(dir, 'args'), 'utf8').trim(), 'auth application-default login --quiet');
  await assert.rejects(gcloudLogin(new AbortController().signal, bad), /Google sign-in failed: ERROR: .*Login cancelled/);
});
