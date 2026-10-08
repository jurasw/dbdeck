import { BaseDriver } from './drivers/base';
import { ElasticDriver, errorText } from './drivers/elastic';
import { docsToGrid, MongoDriver } from './drivers/mongo';
import { SqlDriver } from './drivers/sql';
import { Statement } from './sqlSplit';
import { QueryResult } from './types';
import { errorMessage } from './util';

export function parseEsRequests(text: string): (Statement & { method: string; path: string; body: string })[] {
  const out: (Statement & { method: string; path: string; body: string })[] = [];
  const re = /^[ \t]*(GET|POST|PUT|DELETE|HEAD|PATCH)[ \t]+(\S+)[^\n]*$/gim;
  const heads = [...text.matchAll(re)];
  heads.forEach((m, i) => {
    const start = m.index!;
    const end = i + 1 < heads.length ? heads[i + 1].index! - 1 : text.length;
    const body = text
      .slice(start + m[0].length, end)
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')
      .trim();
    out.push({ text: text.slice(start, end).trim(), start, end, method: m[1].toUpperCase(), path: m[2], body });
  });
  return out;
}

export async function runEs(driver: ElasticDriver, text: string): Promise<QueryResult> {
  const [req] = parseEsRequests(text);
  if (!req) throw new Error('Expected a request like: GET /index/_search');
  let body: string | undefined = req.body || undefined;
  if (body && !/_bulk|_msearch/.test(req.path)) JSON.parse(body);
  if (body && /_bulk|_msearch/.test(req.path)) {
    body = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
  }
  const r = await driver.request(req.method, req.path, body);
  if (r.status >= 400) throw new Error(`${r.status} ${errorText(r.body)}`);
  const res: QueryResult = { columns: [], rows: [], durationMs: r.durationMs, json: r.body, message: `HTTP ${r.status}` };
  const hits = (r.body as { hits?: { hits?: { _id: string; _index: string; _score: number; _source?: object }[] } })?.hits?.hits;
  if (Array.isArray(hits)) Object.assign(res, docsToGrid(hits.map((h) => ({ _id: h._id, _index: h._index, _score: h._score, ...h._source }))));
  else if (Array.isArray(r.body) && r.body.length && typeof r.body[0] === 'object') Object.assign(res, docsToGrid(r.body));
  else if (typeof r.body === 'string') {
    const lines = r.body.replace(/\n$/, '').split('\n');
    Object.assign(res, { columns: [{ name: 'response' }], rows: lines.map((l) => [l]), json: undefined });
  }
  return res;
}

export async function executeQueries(driver: BaseDriver, pieces: string[], database?: string, maxRows = 5000, strictReadOnly = false): Promise<QueryResult[]> {
  const out: QueryResult[] = [];
  for (const sql of pieces) {
    try {
      let result: QueryResult;
      if (driver instanceof SqlDriver) result = strictReadOnly && driver.config.readonly ? await driver.runReadOnly(sql, database) : await driver.run(sql, database);
      else if (driver instanceof MongoDriver) result = await driver.script(database ?? 'test', sql);
      else if (driver instanceof ElasticDriver) result = await runEs(driver, sql);
      else throw new Error('Queries are not supported for this connection');
      if (result.rows.length > maxRows) result = { ...result, rows: result.rows.slice(0, maxRows), truncated: true };
      out.push({ ...result, sql });
    } catch (error) {
      out.push({ columns: [], rows: [], durationMs: 0, sql, error: errorMessage(error) });
      if (driver instanceof SqlDriver) break;
    }
  }
  return out;
}
