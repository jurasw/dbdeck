import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type * as vscode from 'vscode';
import type { ConnectionConfig } from '../src/types';

const prompts: string[] = [];
const answers: string[] = [];
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = (name, ...args) =>
  name === 'vscode'
    ? {
        window: {
          showInputBox: async (options: { prompt: string; password: boolean }) => {
            prompts.push(options.prompt);
            assert.equal(options.password, true);
            return answers.shift();
          },
        },
      }
    : originalLoad(name, ...args);
const { ConnectionStore, createDriver } = require('../src/connections') as typeof import('../src/connections');
loader._load = originalLoad;

function fixture() {
  const data = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const store = new ConnectionStore({
    globalState: {
      get: (key: string, fallback: unknown) => data.get(key) ?? fallback,
      update: async (key: string, value: unknown) => {
        data.set(key, value);
      },
    },
    secrets: {
      get: async (key: string) => secrets.get(key),
      store: async (key: string, value: string) => {
        secrets.set(key, value);
      },
      delete: async (key: string) => {
        secrets.delete(key);
      },
    },
  } as unknown as vscode.ExtensionContext);
  return { store, data, secrets };
}
const config: ConnectionConfig = { id: 'd', name: 'DynamoDB', type: 'dynamodb', user: 'access', password: 'secret', sessionToken: 'temporary' };

test('DynamoDB session tokens stay in SecretStorage and restore without appearing in editor state', async () => {
  const f = fixture();
  await f.store.save(config);
  const plain = JSON.stringify([...f.data.values()]);
  assert.ok(!plain.includes('secret'));
  assert.ok(!plain.includes('temporary"'));
  assert.equal(f.store.get('d')!.temporaryCredentials, true);
  assert.equal((await f.store.full('d'))!.sessionToken, 'temporary');
  assert.equal(JSON.parse([...f.secrets.values()][0]).sessionToken, 'temporary');
  await f.store.remove('d');
  assert.equal(f.secrets.size, 0);
});

test('Remember secret off keeps temporary AWS credentials in memory and prompts again after forgetting', async () => {
  const f = fixture();
  await f.store.save({ ...config, savePassword: false });
  assert.equal(f.secrets.size, 0);
  assert.equal((await f.store.full('d'))!.sessionToken, 'temporary');
  f.store.forget('d');
  const full = (await f.store.full('d'))!;
  assert.equal(full.sessionToken, undefined);
  answers.push('new-secret', 'new-session-token');
  const restored = await f.store.askSecrets(full);
  assert.equal(restored!.password, 'new-secret');
  assert.equal(restored!.sessionToken, 'new-session-token');
  assert.match(prompts.at(-2)!, /Secret access key/);
  assert.match(prompts.at(-1)!, /AWS session token/);
});

test('driver factory exposes the three new query dialects', () => {
  for (const type of ['mssql', 'dynamodb', 'cassandra'] as const) assert.equal((createDriver({ id: type, name: type, type }) as { dialect?: string }).dialect, type);
});

test('Kibana API keys use SecretStorage and stay out of connection metadata', async () => {
  const f = fixture();
  await f.store.save({ id: 'k', name: 'Kibana', type: 'elasticsearch', kibanaUrl: 'https://kibana.example.com', apiKey: 'encoded-secret' });
  assert.ok(!JSON.stringify([...f.data.values()]).includes('encoded-secret'));
  assert.equal((await f.store.full('k'))!.apiKey, 'encoded-secret');
  assert.equal(JSON.parse([...f.secrets.values()][0]).apiKey, 'encoded-secret');
});

test('Kibana with Remember API key off asks for the key after forgetting, without asking for a password', async () => {
  const f = fixture();
  await f.store.save({ id: 'k', name: 'Kibana', type: 'elasticsearch', kibanaUrl: 'https://kibana.example.com', apiKey: 'old-key', user: 'elastic', savePassword: false });
  assert.equal(f.secrets.size, 0);
  const count = prompts.length;
  assert.equal((await f.store.askSecrets((await f.store.full('k'))!))!.apiKey, 'old-key');
  assert.equal(prompts.length, count);
  f.store.forget('k');
  answers.push('  new-key  ');
  const restored = await f.store.askSecrets((await f.store.full('k'))!);
  assert.equal(restored!.apiKey, 'new-key');
  assert.equal(prompts.length, count + 1);
  assert.match(prompts.at(-1)!, /Encoded Kibana API key/);
  assert.equal(f.secrets.size, 0);
  f.store.forget('k');
  assert.equal(await f.store.askSecrets((await f.store.full('k'))!), undefined);
});
