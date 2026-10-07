import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectionUrl } from '../webview/connection-url';

test('reads a Neon PostgreSQL URL with TLS', () => {
  assert.deepEqual(parseConnectionUrl('postgresql://neondb_owner:p%40ss@ep-cool-1.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'), {
    type: 'postgres',
    host: 'ep-cool-1.eu-central-1.aws.neon.tech',
    port: undefined,
    user: 'neondb_owner',
    password: 'p@ss',
    database: 'neondb',
    ssl: true,
    rejectUnauthorized: false,
  });
});

test('reads a Supabase pooler URL and keeps the port', () => {
  const parsed = parseConnectionUrl(' postgres://postgres.abcd:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres ');
  assert.equal(parsed?.type, 'postgres');
  assert.equal(parsed?.user, 'postgres.abcd');
  assert.equal(parsed?.port, 6543);
  assert.equal(parsed?.ssl, undefined);
});

test('keeps port 80 and unencoded @ in passwords', () => {
  const parsed = parseConnectionUrl('mysql://root:a@b@db.local:80/app');
  assert.equal(parsed?.password, 'a@b');
  assert.equal(parsed?.host, 'db.local');
  assert.equal(parsed?.port, 80);
});

test('reads PlanetScale and JSON ssl options', () => {
  assert.deepEqual(parseConnectionUrl('mysql://u:p@aws.connect.psdb.cloud/shop?sslaccept=strict'), {
    type: 'mysql',
    host: 'aws.connect.psdb.cloud',
    port: undefined,
    user: 'u',
    password: 'p',
    database: 'shop',
    ssl: true,
    rejectUnauthorized: true,
  });
  const json = parseConnectionUrl('mysql://u:p@h/db?ssl={"rejectUnauthorized":false}');
  assert.equal(json?.ssl, true);
  assert.equal(json?.rejectUnauthorized, false);
  assert.equal(parseConnectionUrl('postgres://u@h/db?sslmode=verify-full')?.rejectUnauthorized, true);
  assert.equal(parseConnectionUrl('postgres://u@h/db?sslmode=disable')?.ssl, false);
});

test('reads driver suffixes, Redis databases and IPv6 hosts', () => {
  assert.equal(parseConnectionUrl('postgresql+psycopg2://u:p@h/db')?.type, 'postgres');
  assert.deepEqual(parseConnectionUrl('rediss://default:pw@redis.example.com:6380/2'), {
    type: 'redis',
    host: 'redis.example.com',
    port: 6380,
    user: 'default',
    password: 'pw',
    database: '2',
    ssl: true,
  });
  assert.equal(parseConnectionUrl('clickhouse://default@[::1]:8123/logs?secure=true')?.host, '::1');
  assert.equal(parseConnectionUrl('clickhouse://default@[::1]:8123/logs?secure=true')?.ssl, true);
});

test('reads SQLite file URLs', () => {
  assert.deepEqual(parseConnectionUrl('sqlite:////Users/me/app.db'), { type: 'sqlite', database: '/Users/me/app.db' });
  assert.deepEqual(parseConnectionUrl('file:///C:/data/app%20v2.sqlite?mode=ro'), { type: 'sqlite', database: 'C:/data/app v2.sqlite' });
  assert.deepEqual(parseConnectionUrl('file:/tmp/x.db'), { type: 'sqlite', database: '/tmp/x.db' });
});

test('ignores text that is not a supported URL', () => {
  assert.equal(parseConnectionUrl('localhost'), undefined);
  assert.equal(parseConnectionUrl('https://example.com'), undefined);
  assert.equal(parseConnectionUrl('postgres:'), undefined);
  assert.equal(parseConnectionUrl('mongodb://h/db'), undefined);
});
