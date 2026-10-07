import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export function toCell(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return isNaN(v.getTime()) ? String(v) : v.toISOString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    const b = Buffer.from(v as Uint8Array);
    return b.length > 256 ? `0x${b.subarray(0, 256).toString('hex')}…` : `0x${b.toString('hex')}`;
  }
  if (typeof v === 'object') {
    try {
      return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
    } catch {
      return String(v);
    }
  }
  return v;
}

export function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function errorMessage(e: unknown): string {
  if (e instanceof AggregateError && e.errors?.length) return e.errors.map(errorMessage).join('; ');
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

export function formatCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(0)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function formatDate(d: Date | string): string {
  const t = new Date(d);
  if (isNaN(t.getTime())) return String(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export interface HttpOptions {
  method?: string;
  url?: string;
  socketPath?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  rejectUnauthorized?: boolean;
  timeout?: number;
}

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function httpRequest(o: HttpOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let mod: typeof http | typeof https = http;
    const headers: Record<string, string | number> = { ...o.headers };
    const opts: https.RequestOptions = { method: o.method ?? 'GET', headers, timeout: o.timeout ?? 60000 };
    if (o.socketPath) {
      opts.socketPath = o.socketPath;
      opts.path = o.path;
    } else {
      const u = new URL(o.url!);
      if (u.protocol === 'https:') {
        mod = https;
        opts.rejectUnauthorized = o.rejectUnauthorized ?? true;
      }
      opts.hostname = u.hostname.replace(/^\[|\]$/g, '');
      opts.port = u.port;
      opts.path = u.pathname + u.search;
    }
    if (o.body !== undefined) headers['content-length'] = Buffer.byteLength(o.body);
    const req = mod.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

export function fileExists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}
