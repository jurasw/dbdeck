import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateRow } from '../webview/row-duplicate';

test('duplicated rows copy values and leave primary keys for the database', () => {
  const columns = [{ name: 'id', pk: true }, { name: 'name' }, { name: 'meta' }, { name: 'deleted_at' }];
  const source = [42, 'Ada', { tier: 'gold' }, null];
  const copy = duplicateRow(columns, source);
  assert.deepEqual(copy, [undefined, 'Ada', { tier: 'gold' }, null]);
  assert.notEqual(copy, source);
  assert.equal(source[0], 42);
});
