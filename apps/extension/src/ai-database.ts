import { BaseDriver } from './drivers/base';
import { ElasticDriver } from './drivers/elastic';
import { MongoDriver } from './drivers/mongo';
import { SqlDriver } from './drivers/sql';
import { runEsReadOnly } from './query-execution';
import { QueryResult } from './types';

export type AiFamily = 'sql' | 'mongo' | 'es';

export interface AiField {
  name: string;
  type?: string;
  primaryKey?: boolean;
  nullable?: boolean;
}

export interface AiDatabase {
  family: AiFamily;
  dialect: string;
  objects(schema?: string): Promise<{ name: string; schema?: string }[]>;
  fields(ref: { schema?: string; table: string }): Promise<AiField[]>;
  runReadOnly(query: string): Promise<QueryResult>;
}

export function aiDatabase(driver: BaseDriver, database: string | undefined): AiDatabase | undefined {
  if (driver instanceof SqlDriver) {
    return {
      family: 'sql',
      dialect: driver.dialect,
      objects: (schema) => driver.objects(database, schema, null),
      fields: async (ref) =>
        (await driver.columns({ database, schema: ref.schema, table: ref.table })).map((c) => ({
          name: c.name,
          type: c.type,
          primaryKey: c.pk || undefined,
          nullable: c.nullable,
        })),
      runReadOnly: (query) => driver.runReadOnly(query, database),
    };
  }
  if (driver instanceof MongoDriver && database) {
    return {
      family: 'mongo',
      dialect: 'mongodb',
      objects: async () => (await driver.collections(database)).map((name) => ({ name })),
      fields: (ref) => driver.fields(database, ref.table),
      runReadOnly: (query) => driver.readOnly(database, query),
    };
  }
  if (driver instanceof ElasticDriver) {
    return {
      family: 'es',
      dialect: 'elasticsearch',
      objects: async () => (await driver.indices()).map((r) => ({ name: r.index })),
      fields: (ref) => driver.fields(ref.table),
      runReadOnly: (query) => runEsReadOnly(driver, query),
    };
  }
  return undefined;
}
