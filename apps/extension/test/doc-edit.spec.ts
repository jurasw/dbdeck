import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addValue, editText, parseEdit, planWrite, removeValue, renameField, setValue } from '../webview/doc-edit';

const doc = () => ({
  _id: 'b7418e0|32fcf8dc',
  kb: 5595.07,
  renderer: 'webgl',
  firstAt: { $date: '2026-09-30T15:55:01.420Z' },
  frameMs: { p50: 16, p95: 33 },
  tags: ['a', 'b'],
});

test('editing a nested value writes only its top-level field', () => {
  const before = doc();
  const after = setValue(before, ['frameMs', 'p95'], parseEdit('40', 33));
  assert.deepEqual(planWrite(before, after), { field: 'frameMs', value: { p50: 16, p95: 40 } });
  assert.equal(before.frameMs.p95, 33);
  assert.deepEqual(planWrite(before, setValue(before, ['tags', 1], 'c')), { field: 'tags', value: ['a', 'c'] });
  assert.equal(planWrite(before, setValue(before, ['kb'], 5595.07)), null);
});

test('value text keeps strings raw and EJSON wrappers editable', () => {
  assert.equal(editText('webgl'), 'webgl');
  assert.equal(editText(5595.07), '5595.07');
  assert.equal(editText(null), 'null');
  assert.equal(editText({ $date: '2026-09-30T15:55:01.420Z' }), '2026-09-30T15:55:01.420Z');
  assert.equal(editText({ p50: 16 }), '{\n  "p50": 16\n}');
  assert.deepEqual(parseEdit(' 2026-10-01T00:00:00.000Z ', { $date: 'x' }), { $date: '2026-10-01T00:00:00.000Z' });
  assert.equal(parseEdit('1440', 'old'), '1440');
  assert.throws(() => parseEdit('fast', 1), /number/);
  assert.deepEqual(parseEdit('{"p50":1}', { p50: 16 }), { p50: 1 });
});

test('renaming keeps field order and replaces the document', () => {
  const before = doc();
  const after = renameField(before, ['renderer'], 'engine');
  assert.deepEqual(Object.keys(after), ['_id', 'kb', 'engine', 'firstAt', 'frameMs', 'tags']);
  assert.deepEqual(planWrite(before, after), { doc: after });
  assert.deepEqual(Object.keys(renameField(before, ['frameMs', 'p50'], 'median').frameMs), ['median', 'p95']);
  assert.throws(() => renameField(before, ['kb'], 'renderer'), /already exists/);
  assert.throws(() => renameField(before, ['kb'], '_id'), /valid field name/);
  assert.throws(() => renameField(before, ['_id'], 'id'), /_id cannot be changed/);
});

test('adding and deleting fields and items', () => {
  const before = doc();
  const added = addValue(before, [], 'playtest', parseEdit('false', undefined));
  assert.deepEqual(planWrite(before, added), { field: 'playtest', value: false });
  assert.deepEqual(addValue(before, ['tags'], undefined, 'c').tags, ['a', 'b', 'c']);
  assert.deepEqual(addValue(before, ['frameMs'], 'p99', 50).frameMs, { p50: 16, p95: 33, p99: 50 });
  assert.throws(() => addValue(before, [], 'kb', 1), /already exists/);
  assert.deepEqual(removeValue(before, ['tags', 0]).tags, ['b']);
  const removed = removeValue(before, ['kb']);
  assert.equal('kb' in removed, false);
  assert.deepEqual(planWrite(before, removed), { doc: removed });
  assert.throws(() => removeValue(before, ['_id']), /_id cannot be changed/);
});
