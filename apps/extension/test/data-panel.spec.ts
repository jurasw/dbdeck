import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { ConnectionManager } from '../src/connections';
import type { DbNode } from '../src/types';
import { SqlDriver } from '../src/drivers/sql';
import { MongoDriver } from '../src/drivers/mongo';

const panels: any[] = [];
const vscode = {
  Uri: { joinPath: (...parts: unknown[]) => ({ toString: () => parts.join('/') }) },
  ThemeIcon: class {},
  ViewColumn: { Active: 1 },
  workspace: { getConfiguration: () => ({ get: () => 100 }) },
  window: {
    createWebviewPanel: () => {
      const panel = {
        webview: {
          html: '',
          cspSource: 'test:',
          asWebviewUri: (uri: unknown) => uri,
          onDidReceiveMessage: (listener: unknown) => {
            panel.receive = listener;
            return { dispose() {} };
          },
          postMessage: (message: unknown) => panel.messages.push(message),
        },
        messages: [] as any[],
        receive: undefined as any,
        dispose: undefined as any,
        reveals: 0,
        reveal: () => panel.reveals++,
        onDidDispose: (listener: unknown) => (panel.dispose = listener),
      };
      panels.push(panel);
      return panel;
    },
  },
};
const loader = Module as unknown as { _load: (name: string, ...args: any[]) => any };
const originalLoad = loader._load;
loader._load = (name, ...args) => (name === 'vscode' ? vscode : originalLoad(name, ...args));
const { DataPanel } = require('../src/panels/dataPanel') as typeof import('../src/panels/dataPanel');
loader._load = originalLoad;

const node: DbNode = { connId: 'slow', kind: 'collection', database: 'db', table: 'feedback', label: 'feedback' };

test('table panel opens and reuses its tab while the connection is pending', async () => {
  let connect!: (driver: MongoDriver) => void;
  const pending = new Promise<MongoDriver>((resolve) => (connect = resolve));
  let connections = 0;
  const manager = {
    store: { get: () => ({ name: 'Test', type: 'mongodb' }) },
    get: () => {
      connections++;
      return pending;
    },
  } as unknown as ConnectionManager;
  await DataPanel.show({} as any, manager, node, () => {});
  const panel = panels.at(-1);
  assert.ok(panel.webview.html.includes('feedback'));
  assert.ok(panel.receive);
  await DataPanel.show({} as any, manager, node, () => {});
  assert.equal(panel.reveals, 1);
  assert.equal(connections, 1);
  const request = panel.receive({ type: 'rpc', id: 1, method: 'load', params: { skip: 0, limit: 100 } });
  assert.equal(panel.messages.length, 0);
  const driver = new MongoDriver({ id: 'slow', name: 'Test', type: 'mongodb' });
  driver.find = async () => ({ docs: [{ message: 'hello' }], durationMs: 1 });
  connect(driver);
  await request;
  assert.deepEqual(panel.messages[0].result.rows, [['hello']]);
  panel.dispose();
});

test('connection failure reaches the already visible panel as an RPC error', async () => {
  const manager = {
    store: { get: () => ({ name: 'Test', type: 'mongodb' }) },
    get: async () => {
      throw new Error('Connection failed');
    },
  } as unknown as ConnectionManager;
  await DataPanel.show({} as any, manager, node, () => {});
  const panel = panels.at(-1);
  await panel.receive({ type: 'rpc', id: 2, method: 'load' });
  assert.equal(panel.messages[0].error, 'Connection failed');
  panel.dispose();
});

test('AI filter passes only current table metadata and preserves SQL generation for review', async () => {
  const driver = Object.create(SqlDriver.prototype);
  driver.dialect = 'postgres';
  driver.columns = async () => [{ name: 'id', type: 'int' }];
  const manager = { store: { get: () => ({ name: 'Test', type: 'postgres' }) }, get: async () => driver } as unknown as ConnectionManager;
  const ai = {
    status: async () => ({ connected: true, model: 'local' }),
    generate: async (...args: unknown[]) => {
      assert.equal(args[0], 'IDs above ten');
      assert.deepEqual(JSON.parse(args[1] as string), { table: 'users', schema: 'public', columns: [{ name: 'id', type: 'int' }] });
      assert.equal(args[4], true);
      return 'id > 10';
    },
  };
  await DataPanel.show({} as any, manager, { connId: 'ai-test', kind: 'table', database: 'db', schema: 'public', table: 'users', label: 'users' }, () => {}, ai as any, {} as any);
  const panel = panels.at(-1);
  await panel.receive({ type: 'rpc', id: 3, method: 'aiFilter', params: { prompt: 'IDs above ten' } });
  assert.equal(panel.messages[0].result, 'id > 10');
  panel.dispose();
});

test('missing AI setup opens settings and returns to the same table', async () => {
  const driver = Object.create(SqlDriver.prototype);
  driver.dialect = 'postgres';
  driver.objects = async () => [{ name: 'users', schema: 'public' }];
  const manager = { store: { get: () => ({ name: 'Test', type: 'postgres' }) }, get: async () => driver } as unknown as ConnectionManager;
  const ai = { status: async () => ({ connected: false, model: '' }) };
  await DataPanel.show({} as any, manager, { connId: 'ai-setup', kind: 'table', database: 'db', schema: 'public', table: 'users', label: 'users' }, () => {}, ai as any, {} as any);
  const table = panels.at(-1);
  await table.receive({ type: 'rpc', id: 4, method: 'aiFilter', params: { prompt: 'active users' } });
  assert.equal(table.messages[0].result, null);
  const settings = panels.at(-1);
  assert.notEqual(settings, table);
  await settings.receive({ type: 'rpc', id: 5, method: 'back' });
  assert.equal(table.reveals, 1);
  table.dispose();
});

test('AI query opened from a table keeps the whole database as context with that table first', async () => {
  const driver = Object.create(SqlDriver.prototype);
  driver.dialect = 'postgres';
  driver.objects = async (_db: string, schema?: string) => {
    assert.equal(schema, undefined);
    return [
      { name: 'customers', schema: 'crm' },
      { name: 'orders', schema: 'public' },
      { name: 'test', schema: 'public' },
    ];
  };
  driver.columns = async (t: { table: string }) => [{ name: `${t.table}_id`, type: 'int', pk: true, nullable: false }];
  const manager = { store: { get: () => ({ name: 'Test', type: 'postgres' }) }, get: async () => driver } as unknown as ConnectionManager;
  const ai = {
    status: async () => ({ connected: false, model: '' }),
    generate: async (_prompt: string, schema: string) => {
      assert.deepEqual(
        JSON.parse(schema).map((t: { schema: string; table: string }) => `${t.schema}.${t.table}`),
        ['public.test', 'public.orders', 'crm.customers'],
      );
      return 'SELECT count(*) FROM crm.customers';
    },
  };
  await DataPanel.show({} as any, manager, { connId: 'ai-context', kind: 'table', database: 'db', schema: 'public', table: 'test', label: 'test' }, () => {}, ai as any, {} as any);
  const table = panels.at(-1);
  await table.receive({ type: 'rpc', id: 6, method: 'aiFilter', params: { prompt: 'active customers' } });
  const query = panels.at(-1);
  await query.receive({ type: 'rpc', id: 7, method: 'generate', params: { prompt: 'How many customers in crm?' } });
  assert.equal(query.messages.at(-1).result, 'SELECT count(*) FROM crm.customers');
  query.dispose();
  table.dispose();
});
