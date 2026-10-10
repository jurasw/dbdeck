import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepColumnOrder } from '../webview/column-order';

const cols = (...names: string[]) => names.map((name) => ({ name }));

test('keeps previous column positions when a re-sorted page lists fields in another order', () => {
  const r = keepColumnOrder(cols('_id', 'build', 'camps', 'baseDamage'), cols('_id', 'baseDamage', 'build', 'camps'), [
    ['a', 5, 'b1', 3],
    ['b', 7, 'b2', 9],
  ]);
  assert.deepEqual(
    r.columns.map((c) => c.name),
    ['_id', 'build', 'camps', 'baseDamage'],
  );
  assert.deepEqual(r.rows, [
    ['a', 'b1', 3, 5],
    ['b', 'b2', 9, 7],
  ]);
});

test('appends new fields and drops missing ones', () => {
  const r = keepColumnOrder(cols('_id', 'old', 'name'), cols('fresh', 'name', '_id'), [[1, 'n', 'x']]);
  assert.deepEqual(
    r.columns.map((c) => c.name),
    ['_id', 'name', 'fresh'],
  );
  assert.deepEqual(r.rows, [['x', 'n', 1]]);
});

test('uses the server order on the first page', () => {
  const columns = cols('b', 'a');
  const rows = [[1, 2]];
  const r = keepColumnOrder([], columns, rows);
  assert.equal(r.columns, columns);
  assert.equal(r.rows, rows);
});
