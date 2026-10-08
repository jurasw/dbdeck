import { SqlDriver } from "../../extension/src/drivers/sql";
import {
  executeQueries,
  parseEsRequests,
} from "../../extension/src/query-execution";
import { ElasticDriver } from "../../extension/src/drivers/elastic";
import { BaseDriver } from "../../extension/src/drivers/base";
import { splitSql } from "../../extension/src/sqlSplit";
import { QueryResult } from "../../extension/src/types";

export async function runQuery(
  driver: BaseDriver,
  text: string,
  database?: string,
): Promise<QueryResult[]> {
  if (!text.trim()) throw new Error("Write a query first.");
  const statements =
    driver instanceof SqlDriver
      ? splitSql(text, driver.dialect).map((piece) => piece.text)
      : driver instanceof ElasticDriver
        ? parseEsRequests(text).map((piece) => piece.text)
        : [text];
  if (!statements.length) throw new Error("Write a query first.");
  return executeQueries(driver, statements, database, 5000, true);
}
