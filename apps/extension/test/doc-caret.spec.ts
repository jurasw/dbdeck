import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldCaret } from '../webview/doc-caret';

test('document editor caret lands on the value of the clicked field', () => {
  const text = JSON.stringify({ _id: 'a', frames: { kb: 1 }, kb: 5595.07 }, null, 2);
  assert.equal(text.slice(fieldCaret(text, 'kb')), '5595.07\n}');
  assert.equal(text.slice(fieldCaret(text, 'frames')).split('\n')[0], '{');
  assert.equal(fieldCaret(text, 'missing'), 0);
});

test('nested fields fall back to their first occurrence', () => {
  const text = JSON.stringify({ _id: 'a', meta: { 'say "hi"': true } }, null, 2);
  assert.equal(text.slice(fieldCaret(text, 'say "hi"')).split('\n')[0], 'true');
});
