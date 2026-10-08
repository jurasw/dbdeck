import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CursorPages } from '../src/drivers/cursor-pages';

test('native paging scopes cursors by query, supports jumps and resets on reload', async () => {
  const pages = new CursorPages<number>();
  const calls: (string | undefined)[] = [];
  const fetch = async (cursor?: string) => {
    calls.push(cursor);
    const i = Number(cursor || 0);
    return { rows: [i, i + 1], next: i < 4 ? String(i + 2) : undefined };
  };
  assert.deepEqual((await pages.page('a', 2, 4, fetch)).rows, [4, 5]);
  assert.deepEqual(calls, [undefined, '2', '4']);
  calls.length = 0;
  await pages.page('a', 2, 2, fetch);
  assert.deepEqual(calls, ['2']);
  calls.length = 0;
  await pages.page('b', 2, 2, fetch);
  assert.deepEqual(calls, [undefined, '2']);
  await pages.page('a', 2, 0, async () => ({ rows: [1] }));
  assert.deepEqual((await pages.page('a', 2, 4, async () => ({ rows: [1] }))).rows, []);
  await assert.rejects(pages.page('a', 2, 3, fetch), /Invalid/);
});
