export function keepColumnOrder<C extends { name: string }>(prev: C[], columns: C[], rows: unknown[][]): { columns: C[]; rows: unknown[][] } {
  const index = new Map(columns.map((c, i) => [c.name, i]));
  const kept = prev.map((c) => index.get(c.name)).filter((i): i is number => i !== undefined);
  if (!kept.length) return { columns, rows };
  const keptSet = new Set(kept);
  const order = [...kept, ...columns.map((_, i) => i).filter((i) => !keptSet.has(i))];
  if (order.every((i, n) => i === n)) return { columns, rows };
  return { columns: order.map((i) => columns[i]), rows: rows.map((row) => order.map((i) => row[i])) };
}
