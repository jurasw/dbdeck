import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { DbNode, ValueSearchPage } from '../src/types';

const root: DbNode = { connId: 'test', kind: 'schema', label: 'public', schema: 'public', database: 'game' };
const table: DbNode = { ...root, kind: 'table', label: 'players', table: 'players' };
const pause = () => new Promise((resolve) => setTimeout(resolve, 400));
const tick = () => new Promise((resolve) => setImmediate(resolve));
let picker: any;
const vscode = {
  window: {
    createQuickPick: () => {
      const callbacks: Record<string, () => void> = {};
      picker = {
        value: '',
        items: [],
        selectedItems: [],
        busy: false,
        disposed: false,
        show() {},
        hide: () => callbacks.hide(),
        dispose: () => {
          picker.disposed = true;
        },
        onDidChangeValue: (fn: () => void) => {
          callbacks.change = fn;
          return { dispose() {} };
        },
        onDidAccept: (fn: () => void) => {
          callbacks.accept = fn;
          return { dispose() {} };
        },
        onDidHide: (fn: () => void) => {
          callbacks.hide = fn;
          return { dispose() {} };
        },
        change(value: string) {
          this.value = value;
          callbacks.change();
        },
        accept(item: unknown) {
          this.selectedItems = [item];
          callbacks.accept();
        },
      };
      return picker;
    },
    showErrorMessage: (message: string) => assert.fail(message),
  },
};
const loader = Module as unknown as { _load: (name: string, ...args: any[]) => any };
const originalLoad = loader._load;
loader._load = (name, ...args) => (name === 'vscode' ? vscode : originalLoad(name, ...args));
const { showOmnisearch } = require('../src/omnisearch') as typeof import('../src/omnisearch');
loader._load = originalLoad;

test('Omnisearch displays table, value and column, then opens a filtered result', async () => {
  let opened: unknown[] = [];
  const session = showOmnisearch(
    root,
    'Local › game › public',
    {
      children: async () => [table],
      scan: async () => ({ matches: [{ column: 'name', value: 'Jurek' }], limited: false }),
    },
    async (...args) => {
      opened = args;
    },
  );
  picker.change('JUREK');
  await pause();
  assert.equal(picker.busy, false);
  assert.equal(picker.items[0].label, 'players: Jurek (name)');
  assert.equal(picker.items[0].description, 'game › public');
  assert.equal(picker.items[0].alwaysShow, true);
  picker.accept(picker.items[0]);
  await session;
  assert.deepEqual(opened, [table, 'JUREK']);
  assert.equal(picker.disposed, true);
});

test('typing debounces, serializes scans and discards stale results; Escape stops subsequent scans', async () => {
  const queries: string[] = [];
  let finish!: (result: ValueSearchPage) => void;
  const session = showOmnisearch(
    root,
    'game',
    {
      children: async () => [table, { ...table, label: 'teams', table: 'teams' }],
      scan: async (_node, query) => {
        queries.push(query);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
    async () => assert.fail('should not open'),
  );
  picker.change('J');
  picker.change('JUR');
  picker.change('JUREK');
  await pause();
  assert.deepEqual(queries, ['JUREK']);
  picker.change('ANNA');
  await pause();
  assert.deepEqual(queries, ['JUREK']);
  finish({ matches: [{ column: 'name', value: 'Jurek' }], limited: false });
  await tick();
  assert.deepEqual(queries, ['JUREK', 'ANNA']);
  assert.ok(picker.items.every((item: any) => !item.node));
  picker.hide();
  await session;
  finish({ matches: [{ column: 'name', value: 'Anna' }], limited: false });
  await tick();
  assert.deepEqual(queries, ['JUREK', 'ANNA']);
});
