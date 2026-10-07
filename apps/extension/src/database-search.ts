import { searchObjects } from './object-search';
import { errorMessage } from './util';
import type { DbNode, ValueMatch, ValueSearchPage } from './types';

export interface DatabaseSearchSource {
  children(node: DbNode): Promise<DbNode[]>;
  scan(node: DbNode, search: string, cancelled: () => boolean): Promise<ValueSearchPage>;
}

export type DatabaseSearchEvent =
  | { kind: 'match'; node: DbNode; match: ValueMatch }
  | { kind: 'progress'; node: DbNode }
  | { kind: 'warning'; node: DbNode; message: string }
  | { kind: 'done'; limitedTables: number; limitReached: boolean };

export async function* searchDatabaseValues(root: DbNode, search: string, source: DatabaseSearchSource, cancelled: () => boolean): AsyncGenerator<DatabaseSearchEvent> {
  if (!search.trim() || cancelled()) return;
  let count = 0;
  let limitedTables = 0;
  const children = async (node: DbNode): Promise<DbNode[]> => {
    if (node.kind === 'folder' && node.ref !== 'tables' && node.ref !== 'views') return [];
    try {
      return await source.children(node);
    } catch (error) {
      return [{ ...node, kind: 'error', description: errorMessage(error) }];
    }
  };
  for await (const node of searchObjects(root, children, cancelled)) {
    if (node.kind === 'error') {
      yield { kind: 'warning', node, message: node.description || node.label };
      continue;
    }
    if (!['table', 'view', 'collection'].includes(node.kind)) continue;
    yield { kind: 'progress', node };
    if (cancelled()) return;
    try {
      const result = await source.scan(node, search.trim(), cancelled);
      if (cancelled()) return;
      if (result.limited) limitedTables++;
      const seen = new Set<string>();
      for (const match of result.matches) {
        if (cancelled()) return;
        const key = JSON.stringify([match.column, match.value]);
        if (seen.has(key)) continue;
        seen.add(key);
        if (count >= 200) {
          yield { kind: 'done', limitedTables, limitReached: true };
          return;
        }
        count++;
        yield { kind: 'match', node, match };
      }
    } catch (error) {
      if (cancelled()) return;
      yield { kind: 'warning', node, message: errorMessage(error) };
    }
  }
  if (!cancelled()) yield { kind: 'done', limitedTables, limitReached: false };
}
