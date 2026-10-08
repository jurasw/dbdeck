import type { GridColumn } from './grid';

export function duplicateRow(columns: GridColumn[], row: unknown[]): unknown[] {
  return columns.map((c, i) => (c.pk || c.generated ? undefined : row[i]));
}
