import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCell, errorMessage, formatBytes, formatCount } from '../src/util';

test('normalizes database values without losing bigint precision', () => {
  assert.equal(toCell(9007199254740993n), '9007199254740993');
  assert.equal(toCell(undefined), null);
  assert.equal(toCell(new Date('2026-01-01T00:00:00Z')), '2026-01-01T00:00:00.000Z');
  assert.equal(toCell(Buffer.from([0, 255])), '0x00ff');
  assert.deepEqual(toCell({ nested: 9007199254740993n }), { nested: '9007199254740993' });
});
test('limits binary previews to 256 bytes', () => {
  assert.equal(toCell(Buffer.alloc(257, 255)), '0x' + 'ff'.repeat(256) + '…');
});
test('reports every error in an aggregate failure', () => {
  assert.equal(errorMessage(new AggregateError([new Error('first'), new Error('second')])), 'first; second');
});
test('formats size and count boundaries', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1000), '1.0k');
  assert.equal(formatCount(1000000), '1.0M');
});
