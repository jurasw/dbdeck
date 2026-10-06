import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchObjects } from '../src/object-search';
import type { DbNode } from '../src/types';

test('searches collapsed metadata branches without loading table columns', async () => {
  const node = (kind: DbNode['kind'], label: string): DbNode => ({ connId: 'test', kind, label });
  const calls: string[] = [];
  const children: Record<string, DbNode[]> = {
    connection: [node('database', 'db')],
    database: [node('schema', 'public')],
    schema: [node('folder', 'Tables')],
    folder: [node('table', 'users'), node('view', 'active_users')],
  };
  const results: string[] = [];
  for await (const item of searchObjects(
    node('connection', 'local'),
    async (parent) => {
      calls.push(parent.kind);
      return children[parent.kind] ?? [];
    },
    () => false,
  ))
    results.push(item.label);
  assert.deepEqual(results, ['db', 'public', 'users', 'active_users']);
  assert.deepEqual(calls, ['connection', 'database', 'schema', 'folder']);
});

test('closing search stops further metadata requests', async () => {
  let cancelled = false;
  let calls = 0;
  for await (const item of searchObjects(
    { connId: 'test', kind: 'connection', label: 'local' },
    async () => {
      calls++;
      return [{ connId: 'test', kind: 'database', label: 'db' }];
    },
    () => cancelled,
  )) {
    assert.equal(item.label, 'db');
    cancelled = true;
  }
  assert.equal(calls, 1);
});
