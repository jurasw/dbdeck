import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undoChanges } from '../webview/row-undo';

test('undo restores edited values, re-inserts deleted rows and removes inserted rows', () => {
  const undo = undoChanges(
    ['id'],
    {
      updates: [
        { key: { id: 1 }, values: { name: 'Typo' } },
        { key: { id: 2 }, values: { id: 20, email: null } },
      ],
      inserts: [{ id: 3, name: 'New' }],
      deletes: [{ id: 4 }],
    },
    [
      { id: 1, name: 'Ada', email: 'ada@x.dev' },
      { id: 2, name: 'Bob', email: 'bob@x.dev' },
    ],
    [{ id: 4, name: 'Gone', email: null }],
  );
  assert.deepEqual(undo, {
    updates: [
      { key: { id: 1 }, values: { name: 'Ada' } },
      { key: { id: 20 }, values: { id: 2, email: 'bob@x.dev' } },
    ],
    inserts: [{ id: 4, name: 'Gone', email: null }],
    deletes: [{ id: 3 }],
  });
});

test('undo is unavailable when an inserted row gets its key from the database', () => {
  assert.equal(undoChanges(['id'], { updates: [], inserts: [{ name: 'Auto id' }], deletes: [] }, [], []), null);
  assert.equal(undoChanges([], { updates: [], inserts: [], deletes: [] }, [], []), null);
});
