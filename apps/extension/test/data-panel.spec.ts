import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { ConnectionManager } from '../src/connections';
import type { DbNode } from '../src/types';
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
