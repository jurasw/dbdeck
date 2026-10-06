import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

const view = {
  webview: {
    html: '',
    options: {},
    cspSource: 'test:',
    asWebviewUri: (uri: unknown) => uri,
    onDidReceiveMessage: (listener: unknown) => {
      view.receive = listener;
      return { dispose() {} };
    },
    postMessage: async (message: unknown) => view.messages.push(message),
  },
  messages: [] as any[],
  receive: undefined as any,
  show: () => {},
  onDidDispose: () => {},
};
let provider: any;
const vscode = {
  Uri: { joinPath: (...parts: unknown[]) => ({ toString: () => parts.join('/') }) },
  commands: { executeCommand: async () => provider.resolveWebviewView(view) },
};
const loader = Module as unknown as { _load: (name: string, ...args: any[]) => any };
const originalLoad = loader._load;
loader._load = (name, ...args) => (name === 'vscode' ? vscode : originalLoad(name, ...args));
const { ResultsView } = require('../src/panels/resultsView') as typeof import('../src/panels/resultsView');
loader._load = originalLoad;

test('results sent before the first webview is ready arrive after the running state', async () => {
  provider = new ResultsView({} as any);
  await provider.running('Shop', 'SELECT 1');
  await provider.show({ location: 'Shop', results: [] });
  assert.deepEqual(view.messages, []);
  await view.receive({ type: 'rpc', id: 1, method: 'ready' });
  assert.deepEqual(
    view.messages.filter((m) => m.type !== 'rpc:res').map((m) => m.type),
    ['running', 'results'],
  );
  view.messages.length = 0;
  await provider.running('Shop', 'SELECT 2');
  assert.deepEqual(
    view.messages.map((m) => m.type),
    ['running'],
  );
});
