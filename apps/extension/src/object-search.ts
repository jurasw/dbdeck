import type { DbNode } from './types';

const BRANCHES = new Set(['connection', 'database', 'schema', 'folder']);
const OBJECTS = new Set(['database', 'schema', 'table', 'view', 'routine', 'collection', 'esIndex']);

export async function* searchObjects(root: DbNode, children: (node: DbNode) => Promise<DbNode[]>, cancelled: () => boolean): AsyncGenerator<DbNode> {
  const pending = [root];
  while (pending.length && !cancelled()) {
    const parent = pending.shift()!;
    const nodes = await children(parent);
    for (const node of nodes) {
      if (cancelled()) return;
      if (OBJECTS.has(node.kind) || node.kind === 'error') yield node;
      if (BRANCHES.has(node.kind)) pending.push(node);
    }
  }
}
