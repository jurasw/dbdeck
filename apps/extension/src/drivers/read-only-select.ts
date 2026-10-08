import { splitSql, SqlDialect } from '../sqlSplit';

// Inspect keywords outside literals, identifiers and comments. SQL Server has no
// read-only transaction mode, so reject everything except a single SELECT/CTE.
export function sqlCode(sql: string): string {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\[(?:\]\]|[^\]])*\]/g, ' ');
}

export function readOnlySelect(sql: string, dialect: SqlDialect, allowWith = false): string {
  const statements = splitSql(sql, dialect);
  if (statements.length !== 1) throw new Error('Run exactly one read-only statement.');
  const text = statements[0].text;
  const tokens = sqlCode(text);
  if (
    !(allowWith ? /^\s*(SELECT|WITH)\b/i : /^\s*SELECT\b/i).test(tokens) ||
    /\b(INSERT|UPDATE|DELETE|MERGE|INTO|EXEC|EXECUTE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|USE|SET|BEGIN|COMMIT|ROLLBACK)\b/i.test(tokens)
  ) {
    throw new Error('This query is not read-only. Use a single SELECT statement.');
  }
  return text;
}
