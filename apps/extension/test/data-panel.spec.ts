import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { ConnectionManager } from '../src/connections';
import type { DbNode } from '../src/types';
import { SqlDriver } from '../src/drivers/sql';
import { MongoDriver } from '../src/drivers/mongo';
import { ElasticDriver } from '../src/drivers/elastic';

const ASSETS: Record<string, string> = {
  'codicon.css': '@font-face { src: url("./codicon.ttf?v=1") }',
  'codicon.ttf': 'test-font',
  'style.css': '.grid {}',
  'data.js': 'window.dataPanelReady = "</script>";',
  'ai.js': '',
};
const root = mkdtempSync(join(tmpdir(), 'dbdeck-assets-'));
mkdirSync(join(root, 'dist', 'webview'), { recursive: true });
for (const [file, text] of Object.entries(ASSETS)) writeFileSync(join(root, 'dist', 'webview', file), text);

const panels: any[] = [];
const commands: unknown[][] = [];
const vscode = {
  commands: { executeCommand: (...args: unknown[]) => commands.push(args) },
  Uri: { joinPath: (...parts: unknown[]) => ({ fsPath: join(root, ...(parts.slice(1) as string[])), toString: () => parts.join('/') }) },
  ThemeIcon: class {},
  ViewColumn: { Active: 1 },
  workspace: { getConfiguration: () => ({ get: () => 100 }) },
  window: {
    createWebviewPanel: (_type: string, title: string, show: unknown) => {
      const panel = {
        show,
        webview: {
          html: '',
          cspSource: 'test:',
          asWebviewUri: (uri: unknown) => uri,
          onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
            panel.listeners.push(listener);
            return { dispose() {} };
          },
          postMessage: (message: unknown) => panel.messages.push(message),
        },
        messages: [] as any[],
        listeners: [] as ((message: unknown) => unknown)[],
        receive: (message: unknown) => Promise.all(panel.listeners.map((listener) => listener(message))),
        title,
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

function initialState(panel: any): any {
  const script = panel.webview.html.match(/<script[^>]*>(window\.__INIT__ = .*?)<\/script>/s)![1];
  const context = { window: {} as any };
  runInNewContext(script, context);
  return JSON.parse(JSON.stringify(context.window.__INIT__));
}

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
  assert.ok(panel.webview.html.includes('window.dataPanelReady = "<\\/script>";'));
  assert.ok(panel.webview.html.includes('.grid {}'));
  assert.ok(panel.webview.html.includes(`url("data:font/ttf;base64,${Buffer.from('test-font').toString('base64')}")`));
  assert.ok(!/<link|<script[^>]* src=/.test(panel.webview.html));
  assert.ok(panel.listeners.length);
  assert.equal(initialState(panel).initialData, undefined);
  await DataPanel.show({} as any, manager, node, () => {});
  assert.equal(panel.reveals, 1);
  assert.equal(connections, 1);
  const request = panel.receive({ type: 'rpc', id: 1, method: 'initialLoad' });
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
  await panel.receive({ type: 'rpc', id: 2, method: 'initialLoad' });
  assert.equal(panel.messages[0].error, 'Connection failed');
  panel.dispose();
});

for (const type of ['postgres', 'mongodb', 'elasticsearch'] as const) {
  test(`${type} includes fast rows in the first document without waiting for webview RPC`, async () => {
    const driver = Object.create(type === 'postgres' ? SqlDriver.prototype : type === 'mongodb' ? MongoDriver.prototype : ElasticDriver.prototype);
    const value = '</script><script>window.injected = true</script>';
    let calls = 0;
    driver.page =
      driver.find =
      driver.search =
        async () => {
          calls++;
          return { columns: [{ name: 'name' }], rows: [[value]], docs: [{ name: value }], durationMs: 15 };
        };
    const manager = { store: { get: () => ({ name: 'Test', type }) }, get: async () => driver } as unknown as ConnectionManager;
    await DataPanel.show({} as any, manager, { ...node, connId: type }, () => {});
    const panel = panels.at(-1);
    const state = initialState(panel);
    assert.deepEqual(state.initialData.rows, [[value]]);
    assert.equal(state.initialData.durationMs, 15);
    assert.equal(calls, 1);
    assert.deepEqual(panel.messages, []);
    assert.ok(!panel.webview.html.includes(value));
    await panel.receive({ type: 'rpc', id: 1, method: 'load', params: { limit: 100, offset: 0 } });
    assert.equal(calls, 2);
    panel.dispose();
  });

  test(`${type} fetches before the webview requests rows and refresh fetches fresh data`, async () => {
    const driver = Object.create(type === 'postgres' ? SqlDriver.prototype : type === 'mongodb' ? MongoDriver.prototype : ElasticDriver.prototype);
    const calls: unknown[] = [];
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => (finish = resolve));
    const fetch = (...args: unknown[]) => {
      calls.push(args.at(-1));
      return pending;
    };
    driver.page = driver.find = driver.search = fetch;
    const manager = { store: { get: () => ({ name: 'Test', type }) }, get: async () => driver } as unknown as ConnectionManager;
    await DataPanel.show({} as any, manager, { ...node, connId: type }, () => {});
    const panel = panels.at(-1);
    assert.equal(initialState(panel).initialData, undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [type === 'postgres' ? { limit: 100, offset: 0 } : type === 'mongodb' ? { limit: 100, skip: 0 } : { size: 100, from: 0 }]);
    assert.equal(panel.messages.length, 0);
    const request = panel.receive({ type: 'rpc', id: 1, method: 'initialLoad' });
    finish({ columns: [{ name: 'name' }], rows: [['Ada']], docs: [{ name: 'Ada' }], durationMs: 15 });
    await request;
    assert.equal(calls.length, 1);
    assert.deepEqual(panel.messages[0].result.rows, [['Ada']]);
    await panel.receive({ type: 'rpc', id: 2, method: 'load', params: { ...(calls[0] as object), search: 'Ada' } });
    assert.equal(calls.length, 2);
    assert.equal((calls[1] as any).search, 'Ada');
    panel.dispose();
  });
}

test('closing a panel during startup never writes HTML after disposal', async () => {
  let connect!: (driver: MongoDriver) => void;
  const driver = Object.create(MongoDriver.prototype);
  let calls = 0;
  driver.find = async () => {
    calls++;
    return { docs: [], durationMs: 1 };
  };
  const manager = {
    store: { get: () => ({ name: 'Test', type: 'mongodb' }) },
    get: () => new Promise<MongoDriver>((resolve) => (connect = resolve)),
  } as unknown as ConnectionManager;
  const showing = DataPanel.show({} as any, manager, node, () => {});
  const panel = panels.at(-1);
  panel.dispose();
  connect(driver);
  await showing;
  assert.equal(panel.webview.html, '');
  assert.equal(calls, 0);
});

test('a prefetched query failure is reported and refresh retries it', async () => {
  const driver = Object.create(SqlDriver.prototype);
  let calls = 0;
  driver.page = async () => {
    if (++calls === 1) throw new Error('Query failed');
    return { columns: [], rows: [], durationMs: 1 };
  };
  const manager = { store: { get: () => ({ name: 'Test', type: 'postgres' }) }, get: async () => driver } as unknown as ConnectionManager;
  await DataPanel.show({} as any, manager, node, () => {});
  const panel = panels.at(-1);
  await new Promise((resolve) => setImmediate(resolve));
  await panel.receive({ type: 'rpc', id: 1, method: 'initialLoad' });
  assert.equal(panel.messages[0].error, 'Query failed');
  await panel.receive({ type: 'rpc', id: 2, method: 'load', params: { limit: 100, offset: 0 } });
  assert.deepEqual(panel.messages[1].result.rows, []);
  assert.equal(calls, 2);
  panel.dispose();
});

test('Omnisearch opens a filtered tab without replacing the regular table tab', async () => {
  const driver = Object.create(SqlDriver.prototype);
  const calls: unknown[] = [];
  driver.page = async (_ref: unknown, options: unknown) => {
    calls.push(options);
    return { columns: [{ name: 'name' }], rows: [['Jurek']], durationMs: 1 };
  };
  const manager = { store: { get: () => ({ name: 'Test', type: 'postgres' }) }, get: async () => driver } as unknown as ConnectionManager;
  await DataPanel.show({} as any, manager, node, () => {});
  const regular = panels.at(-1);
  await DataPanel.show({} as any, manager, node, () => {}, undefined, undefined, 'JUREK');
  const filtered = panels.at(-1);
  assert.notEqual(filtered, regular);
  await filtered.receive({ type: 'rpc', id: 1, method: 'initialLoad' });
  assert.deepEqual(calls, [
    { limit: 100, offset: 0 },
    { limit: 100, offset: 0, search: 'JUREK' },
  ]);
  assert.ok(filtered.webview.html.includes('"initialSearch":"JUREK"'));
  await DataPanel.show({} as any, manager, node, () => {}, undefined, undefined, 'JUREK');
  assert.equal(filtered.reveals, 1);
  assert.equal(regular.reveals, 0);
  regular.dispose();
  filtered.dispose();
});

test('closing a panel before connection completes skips the initial query', async () => {
  let connect!: (driver: MongoDriver) => void;
  const pending = new Promise<MongoDriver>((resolve) => (connect = resolve));
  const driver = Object.create(MongoDriver.prototype);
  let calls = 0;
  driver.find = async () => {
    calls++;
    return { docs: [], durationMs: 1 };
  };
  const manager = { store: { get: () => ({ name: 'Test', type: 'mongodb' }) }, get: () => pending } as unknown as ConnectionManager;
  await DataPanel.show({} as any, manager, node, () => {});
  panels.at(-1).dispose();
  connect(driver);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
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

test('opening another table swaps the preview panel content without a new webview', async () => {
  const driver = Object.create(SqlDriver.prototype);
  const tables: string[] = [];
  driver.page = async (ref: { table: string }) => {
    tables.push(ref.table);
    return { columns: [{ name: 'table' }], rows: [[ref.table]], durationMs: 1 };
  };
  const manager = { store: { get: () => ({ name: 'Test', type: 'postgres' }) }, get: async () => driver } as unknown as ConnectionManager;
  const table = (name: string): DbNode => ({ connId: 'preview', kind: 'table', database: 'db', schema: 'public', table: name, label: name });
  await DataPanel.show({} as any, manager, table('users'), () => {});
  const panel = panels.at(-1);
  const html = panel.webview.html;
  await DataPanel.show({} as any, manager, table('orders'), () => {});
  assert.equal(panels.at(-1), panel);
  assert.equal(panel.webview.html, html);
  assert.equal(panel.title, 'orders');
  const mount = panel.messages.find((m: any) => m.type === 'mount');
  assert.equal(mount.init.title, 'orders');
  assert.deepEqual(mount.init.initialData.rows, [['orders']]);
  await panel.receive({ type: 'rpc', id: 1, method: 'load', params: { limit: 100, offset: 0 } });
  assert.deepEqual(panel.messages.at(-1).result.rows, [['orders']]);
  assert.deepEqual(tables, ['users', 'orders', 'orders']);
  await DataPanel.show({} as any, manager, table('orders'), () => {});
  assert.equal(panels.at(-1), panel);
  await DataPanel.show({} as any, manager, table('users'), () => {});
  const pinnedByReopen = panels.at(-1);
  assert.notEqual(pinnedByReopen, panel);
  await pinnedByReopen.receive({ type: 'pin' });
  await DataPanel.show({} as any, manager, table('items'), () => {});
  assert.notEqual(panels.at(-1), pinnedByReopen);
  panels.at(-1).dispose();
  pinnedByReopen.dispose();
  panel.dispose();
});

test('the start tab turns into the first table without a new webview', async () => {
  const driver = Object.create(SqlDriver.prototype);
  driver.page = async (ref: { table: string }) => ({ columns: [{ name: 'table' }], rows: [[ref.table]], durationMs: 1 });
  const manager = { store: { get: () => ({ name: 'Test', type: 'postgres' }) }, get: async () => driver } as unknown as ConnectionManager;
  const users: DbNode = { connId: 'home', kind: 'table', database: 'db', schema: 'public', table: 'users', label: 'users' };
  DataPanel.home({} as any, manager, [{ node: users, location: 'Test › db › public' }]);
  const home = panels.at(-1);
  assert.equal(home.title, 'DBDeck');
  assert.equal(home.show.preserveFocus, true);
  assert.deepEqual(initialState(home), { mode: 'home', recent: [{ node: users, location: 'Test › db › public' }] });
  await home.receive({ type: 'open', node: users });
  assert.deepEqual(commands.at(-1), ['dbdeck.openTable', users]);
  await DataPanel.show({} as any, manager, users, () => {});
  assert.equal(panels.at(-1), home);
  assert.equal(home.title, 'users');
  assert.deepEqual(home.messages.find((m: any) => m.type === 'mount').init.initialData.rows, [['users']]);
  DataPanel.home({} as any, manager, []);
  assert.equal(panels.at(-1), home);
  home.dispose();
});
