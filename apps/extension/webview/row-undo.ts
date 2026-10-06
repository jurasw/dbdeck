export interface RowChanges {
  updates: { key: Record<string, unknown>; values: Record<string, unknown> }[];
  inserts: Record<string, unknown>[];
  deletes: Record<string, unknown>[];
}

const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k]]));

export function undoChanges(pks: string[], changes: RowChanges, updatedRows: Record<string, unknown>[], deletedRows: Record<string, unknown>[]): RowChanges | null {
  if (!pks.length || changes.inserts.some((row) => pks.some((k) => row[k] === undefined || row[k] === null))) return null;
  return {
    deletes: changes.inserts.map((row) => pick(row, pks)),
    updates: changes.updates.map((u, i) => ({
      key: {
        ...u.key,
        ...pick(
          u.values,
          pks.filter((k) => k in u.values),
        ),
      },
      values: pick(updatedRows[i], Object.keys(u.values)),
    })),
    inserts: deletedRows,
  };
}
