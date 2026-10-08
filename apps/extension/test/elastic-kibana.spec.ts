import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { ElasticDriver, elasticApiKey, errorText, kibanaEndpoints } from '../src/drivers/elastic';
import { ConnectionConfig } from '../src/types';

test('Kibana URLs are reduced to the base path and Elastic Cloud gets a direct endpoint', () => {
  assert.deepEqual(kibanaEndpoints('https://kibana.example.com/app/discover#/?_g=()'), { kibana: 'https://kibana.example.com', direct: undefined });
  assert.deepEqual(kibanaEndpoints('kibana.example.com/logs/s/team/app/home'), { kibana: 'https://kibana.example.com/logs', direct: undefined });
  assert.deepEqual(kibanaEndpoints('https://prod-a1.kb.europe-west3.gcp.cloud.es.io:9243/login'), {
    kibana: 'https://prod-a1.kb.europe-west3.gcp.cloud.es.io:9243',
    direct: 'https://prod-a1.es.europe-west3.gcp.cloud.es.io:9243',
  });
});

async function kibana(handler: (req: IncomingMessage, url: URL, body: string, res: ServerResponse) => void) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => handler(req, new URL(req.url!, 'http://localhost'), body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/app/home`, close: () => server.close() };
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const config = (url: string, patch: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  id: 'e1',
  name: 'es',
  type: 'elasticsearch',
  kibanaUrl: url,
  apiKey: 'a2V5',
  ...patch,
});

test('Elasticsearch requests go through the Kibana console proxy with the API key', async () => {
  const seen: string[] = [];
  const k = await kibana((req, url, body, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(url.pathname, '/api/console/proxy');
    assert.equal(req.headers['kbn-xsrf'], 'true');
    assert.equal(req.headers.authorization, 'ApiKey a2V5');
    seen.push(`${url.searchParams.get('method')} ${url.searchParams.get('path')}${body ? ` ${body}` : ''}`);
    if (url.searchParams.get('path') === '/') return json(res, 200, { version: { number: '8.15.0' } });
    if (url.searchParams.get('path')!.startsWith('/_cat/indices'))
      return json(res, 200, [{ index: 'logs-app', health: 'green', status: 'open', 'docs.count': '12', 'store.size': '1kb' }]);
    json(res, 200, { took: 3, hits: { total: { value: 1 }, hits: [{ _id: '1', _source: { msg: 'hi' } }] } });
  });
  try {
    const d = new ElasticDriver(config(k.url));
    await d.connect();
    assert.equal(d.version, '8.15.0');
    assert.deepEqual(
      (await d.children()).map((n) => n.label),
      ['logs-app'],
    );
    const r = await d.search('logs-app', { from: 0, size: 10 });
    assert.equal(r.total, 1);
    assert.equal(seen[0], 'GET /');
    assert.match(seen[2], /^POST \/logs-app\/_search \{"from":0,"size":10/);
  } finally {
    k.close();
  }
});

test('Kibana sign-in problems explain the next step', async () => {
  let status = 401;
  const k = await kibana((_req, _url, _body, res) => json(res, status, { statusCode: status, message: 'nope' }));
  try {
    await assert.rejects(new ElasticDriver(config(k.url)).connect(), /rejected the API key/);
    status = 403;
    await assert.rejects(new ElasticDriver(config(k.url)).connect(), /Dev Tools privilege/);
    await assert.rejects(new ElasticDriver(config(k.url, { apiKey: undefined })).connect(), /Open Kibana API keys/);
  } finally {
    k.close();
  }
});

test('Kibana URLs accept custom domains and reject invalid protocols and embedded credentials', () => {
  assert.deepEqual(kibanaEndpoints('https://kibana.elastic.megarax.net'), { kibana: 'https://kibana.elastic.megarax.net', direct: undefined });
  assert.equal(kibanaEndpoints('https://kibana.example.com/logs/s/team').kibana, 'https://kibana.example.com/logs');
  for (const url of ['', 'ftp://kibana.example.com', 'https://user:secret@kibana.example.com', 'not a URL']) {
    assert.throws(() => kibanaEndpoints(url), /valid HTTP or HTTPS Kibana URL/);
  }
});

test('copied API key headers and id:key pairs produce the correct authorization value', () => {
  assert.equal(elasticApiKey('  ApiKey a2V5  '), 'a2V5');
  assert.equal(elasticApiKey('id:key'), Buffer.from('id:key').toString('base64'));
  assert.throws(() => elasticApiKey('  '), /Encoded API key/);
  assert.throws(() => elasticApiKey('Authorization: ApiKey key'), /without the request headers/);
});

test('browser redirects, HTML login pages and unrelated JSON are never successful Kibana connections', async () => {
  let response = 'redirect';
  const k = await kibana((_req, _url, _body, res) => {
    if (response === 'json') return json(res, 200, { message: 'login required' });
    if (response === 'redirect') {
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': response === 'html' ? 'text/html' : 'text/plain' });
    res.end('<!doctype html><html><body>Sign in with Google</body></html>');
  });
  try {
    for (response of ['redirect', 'html', 'plain']) {
      await assert.rejects(new ElasticDriver(config(k.url)).connect(), /browser login page or redirect/);
    }
    response = 'json';
    await assert.rejects(new ElasticDriver(config(k.url)).connect(), /did not return Elasticsearch cluster information/);
  } finally {
    k.close();
  }
});

test('Kibana routing and permission errors describe their distinct causes', async () => {
  const k = await kibana((_req, _url, _body, res) => json(res, 404, { message: 'Not Found' }));
  try {
    await assert.rejects(new ElasticDriver(config(k.url)).connect(), /Check the Kibana URL and base path/);
  } finally {
    k.close();
  }
  assert.equal(errorText({ statusCode: 400, message: 'Bad proxy request' }), 'Bad proxy request');
});
