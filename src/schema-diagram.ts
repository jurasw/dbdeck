import { SqlDriver } from './drivers/sql';
import { ColumnMeta, TableRef } from './types';

export interface DiagramTable extends TableRef {
  id: string;
  columns: ColumnMeta[];
}
export interface DiagramRelation {
  name: string;
  source: string;
  target: string;
  sourceColumn: string;
  targetColumn: string;
}
export interface SchemaDiagram {
  tables: DiagramTable[];
  relations: DiagramRelation[];
}
export function tableId(schema: string | undefined, table: string): string {
  return JSON.stringify([schema ?? '', table]);
}

export async function loadSchemaDiagram(driver: SqlDriver, database: string, schema?: string): Promise<SchemaDiagram> {
  const tables: DiagramTable[] = [];
  const objects = await driver.objects(database, schema, null);
  // Keep metadata requests bounded, including on large schemas.
  for (let i = 0; i < objects.length; i += 8) {
    tables.push(
      ...(await Promise.all(
        objects.slice(i, i + 8).map(async (object) => {
          const ref = { database, schema: object.schema, table: object.name };
          return { ...ref, id: tableId(ref.schema, ref.table), columns: await driver.columns(ref) };
        }),
      )),
    );
  }
  if (driver.dialect === 'clickhouse') return { tables, relations: [] };
  const sql =
    driver.dialect === 'postgres'
      ? `SELECT con.conname, ns.nspname, src.relname, a.attname, nt.nspname, dst.relname, b.attname
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = src.relnamespace
       JOIN pg_class dst ON dst.oid = con.confrelid JOIN pg_namespace nt ON nt.oid = dst.relnamespace
       CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS keys(source, target)
       JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = keys.source
       JOIN pg_attribute b ON b.attrelid = dst.oid AND b.attnum = keys.target
       WHERE con.contype = 'f' ${schema ? 'AND ns.nspname = $1' : ''} ORDER BY ns.nspname, src.relname, con.conname`
      : `SELECT constraint_name, table_schema, table_name, column_name, referenced_table_schema, referenced_table_name, referenced_column_name
       FROM information_schema.key_column_usage WHERE table_schema = ? AND referenced_table_name IS NOT NULL
       ORDER BY table_name, constraint_name, ordinal_position`;
  const result = await driver.run(sql, database, driver.dialect === 'postgres' ? (schema ? [schema] : []) : [database]);
  const ids = new Set(tables.map((t) => t.id));
  const relations = result.rows
    .filter((row) => driver.dialect === 'postgres' || String(row[4]) === database)
    .map((row) => ({
      name: String(row[0]),
      source: tableId(driver.dialect === 'postgres' ? String(row[1]) : undefined, String(row[2])),
      sourceColumn: String(row[3]),
      target: tableId(driver.dialect === 'postgres' ? String(row[4]) : undefined, String(row[5])),
      targetColumn: String(row[6]),
    }))
    .filter((r) => ids.has(r.source) && ids.has(r.target));
  return { tables, relations };
}
