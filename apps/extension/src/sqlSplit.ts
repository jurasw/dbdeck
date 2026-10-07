export interface Statement {
  text: string;
  start: number;
  end: number;
}

export type SqlDialect = 'mysql' | 'postgres' | 'clickhouse' | 'bigquery' | 'snowflake';

export function splitSql(src: string, dialect: SqlDialect = 'postgres'): Statement[] {
  const out: Statement[] = [];
  let start = 0;
  let i = 0;
  const n = src.length;
  const push = (end: number) => {
    const raw = src.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text && stripComments(text).trim()) out.push({ text, start: start + lead, end: start + lead + text.length });
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '-' && next === '-') {
      i = lineEnd(src, i);
    } else if (c === '#' && (dialect === 'mysql' || dialect === 'bigquery')) {
      i = lineEnd(src, i);
    } else if (c === '/' && next === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e === -1 ? n : e + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      i = quoteEnd(src, i, c, dialect !== 'postgres');
    } else if (c === '$' && (dialect === 'postgres' || dialect === 'snowflake')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i, i + 64));
      if (m) {
        const e = src.indexOf(m[0], i + m[0].length);
        i = e === -1 ? n : e + m[0].length;
      } else i++;
    } else if (c === ';') {
      push(i);
      start = i + 1;
      i++;
    } else i++;
  }
  push(n);
  return out;
}

function lineEnd(src: string, i: number): number {
  const e = src.indexOf('\n', i);
  return e === -1 ? src.length : e + 1;
}

function quoteEnd(src: string, i: number, q: string, backslash: boolean): number {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (backslash && c === '\\') {
      j += 2;
      continue;
    }
    if (c === q) {
      if (src[j + 1] === q) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return src.length;
}

export function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|#).*$/gm, '');
}

export function statementAt(stmts: Statement[], offset: number): Statement | undefined {
  let best: Statement | undefined;
  for (const s of stmts) {
    if (offset >= s.start && offset <= s.end + 1) return s;
    if (s.start <= offset) best = s;
  }
  return best ?? stmts[0];
}
