export interface CursorPage<T> {
  rows: T[];
  next?: string;
}

// UI offsets are translated to native continuation tokens. Tokens belong to the
// exact query and page size; a first-page reload always starts a fresh traversal.
export class CursorPages<T> {
  private queries = new Map<string, Map<number, string | undefined>>();

  clear(): void {
    this.queries.clear();
  }

  async page(key: string, limit: number, offset: number, fetch: (cursor?: string) => Promise<CursorPage<T>>): Promise<CursorPage<T>> {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0 || offset % limit) throw new Error('Invalid page size or offset.');
    if (offset === 0 || !this.queries.has(key)) {
      if (this.queries.size >= 32) this.queries.delete(this.queries.keys().next().value!);
      this.queries.set(key, new Map([[0, undefined]]));
    }
    const cursors = this.queries.get(key)!;
    let position = Math.max(...[...cursors.keys()].filter((n) => n <= offset));
    let result: CursorPage<T>;
    do {
      result = await fetch(cursors.get(position));
      if (!result.next) {
        for (const n of cursors.keys()) if (n > position) cursors.delete(n);
        return position === offset ? result : { rows: [] };
      }
      cursors.set(position + limit, result.next);
      if (position === offset) return result;
      position += limit;
    } while (position <= offset);
    return { rows: [] };
  }
}
