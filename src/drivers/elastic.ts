import { DbNode, QueryResult } from '../types';
import { formatCount, httpRequest } from '../util';
import { BaseDriver } from './base';
import { docsToGrid } from './mongo';

export interface EsResponse {
  status: number;
  body: unknown;
  durationMs: number;
}

export interface SearchOptions {
  query?: string;
  from: number;
  size: number;
  sort?: string;
}

const HEALTH_COLOR: Record<string, string> = { green: 'charts.green', yellow: 'charts.yellow', red: 'charts.red' };

export class ElasticDriver extends BaseDriver {
  private base = '';
  version = '';

  async connect(): Promise<void> {
    const { host, port } = await this.endpoint(9200);
    const proto = this.config.ssl ? 'https' : 'http';
    this.base = `${proto}://${host.includes(':') ? `[${host}]` : host}:${port}`;
    const r = await this.request('GET', '/');
    if (r.status >= 400) throw new Error(errorText(r.body) || `HTTP ${r.status}`);
    this.version = (r.body as { version?: { number?: string } })?.version?.number ?? '';
  }

  protected async disconnect(): Promise<void> {
    this.base = '';
  }

  async request(method: string, path: string, body?: unknown): Promise<EsResponse> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.config.apiKey) headers.authorization = `ApiKey ${this.config.apiKey}`;
    else if (this.config.user) headers.authorization = `Basic ${Buffer.from(`${this.config.user}:${this.config.password ?? ''}`).toString('base64')}`;
    let payload: string | undefined;
    if (body !== undefined && body !== '') {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      headers['content-type'] = /_bulk|_msearch/.test(path) ? 'application/x-ndjson' : 'application/json';
      if (headers['content-type'] === 'application/x-ndjson' && !payload.endsWith('\n')) payload += '\n';
    }
    if (this.config.readonly && method.toUpperCase() !== 'GET' && !/\/_(search|count|msearch|mapping|explain|validate)/.test(path)) {
      throw new Error('This connection is read-only');
    }
    const t = Date.now();
    const r = await httpRequest({
      method: method.toUpperCase(),
      url: this.base + (path.startsWith('/') ? path : `/${path}`),
      headers,
      body: payload,
      rejectUnauthorized: this.config.rejectUnauthorized ?? false,
    });
    const durationMs = Date.now() - t;
    let parsed: unknown = r.body;
    if (String(r.headers['content-type'] ?? '').includes('json')) {
      try {
        parsed = JSON.parse(r.body);
      } catch {
        parsed = r.body;
      }
    }
    return { status: r.status, body: parsed, durationMs };
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.request(method, path, body);
    if (r.status >= 400) throw new Error(errorText(r.body) || `HTTP ${r.status}`);
    return r.body as T;
  }

  async indices(): Promise<{ index: string; health: string; status: string; 'docs.count': string; 'store.size': string }[]> {
    const rows = await this.json<{ index: string; health: string; status: string; 'docs.count': string; 'store.size': string }[]>(
      'GET',
      '/_cat/indices?format=json&h=index,health,status,docs.count,store.size&s=index',
    );
    return rows.filter((r) => this.config.showSystem || !r.index.startsWith('.'));
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const rows = await this.indices();
      return rows.map((r) =>
        this.node('esIndex', r.index, {
          table: r.index,
          description: `${formatCount(Number(r['docs.count'] ?? 0))} docs · ${r['store.size'] ?? ''}${r.status === 'close' ? ' · closed' : ''}`,
          icon: 'symbol-file',
          color: HEALTH_COLOR[r.health],
          tooltip: `health: ${r.health}`,
          tags: 'esIndex es',
        }),
      );
    }
    if (n.kind === 'esIndex') {
      const fields = await this.fields(n.table!);
      return fields.map((f) =>
        this.node('esField', f.name, { table: n.table, description: f.type, icon: 'symbol-field', leaf: true, tags: 'esField' }),
      );
    }
    return [];
  }

  async fields(index: string): Promise<{ name: string; type: string }[]> {
    const m = await this.json<Record<string, { mappings?: { properties?: Record<string, unknown> } }>>('GET', `/${encodeURIComponent(index)}/_mapping`);
    const out: { name: string; type: string }[] = [];
    const walk = (props: Record<string, unknown> | undefined, prefix: string) => {
      for (const [k, v] of Object.entries(props ?? {})) {
        const def = v as { type?: string; properties?: Record<string, unknown> };
        if (def.properties) walk(def.properties, `${prefix}${k}.`);
        else out.push({ name: prefix + k, type: def.type ?? 'object' });
      }
    };
    for (const idx of Object.values(m)) walk(idx.mappings?.properties, '');
    return out;
  }

  async search(index: string, o: SearchOptions): Promise<QueryResult & { total: number }> {
    const q = o.query?.trim();
    let body: Record<string, unknown> = { from: o.from, size: o.size, track_total_hits: true };
    if (q?.startsWith('{')) {
      const dsl = JSON.parse(q) as Record<string, unknown>;
      body = { ...body, ...(dsl.query || dsl.aggs ? dsl : { query: dsl }) };
    } else if (q) body.query = { query_string: { query: q } };
    if (o.sort?.trim()) {
      body.sort = o.sort.split(',').map((s) => {
        const [field, dir] = s.trim().split(/\s+/);
        return { [field]: { order: (dir ?? 'asc').toLowerCase() } };
      });
    }
    const r = await this.request('POST', `/${encodeURIComponent(index)}/_search`, body);
    if (r.status >= 400) throw new Error(errorText(r.body) || `HTTP ${r.status}`);
    const res = r.body as { hits: { total: number | { value: number }; hits: { _id: string; _source?: Record<string, unknown> }[] }; took: number };
    const docs = res.hits.hits.map((h) => ({ _id: h._id, ...h._source }));
    const grid = docsToGrid(docs);
    const total = typeof res.hits.total === 'number' ? res.hits.total : res.hits.total?.value ?? docs.length;
    return { ...grid, durationMs: r.durationMs, total, message: `took ${res.took} ms` };
  }
}

export function errorText(body: unknown): string {
  if (typeof body === 'string') return body;
  const e = (body as { error?: { reason?: string; type?: string; root_cause?: { reason?: string }[] } | string })?.error;
  if (!e) return '';
  if (typeof e === 'string') return e;
  return [e.type, e.reason ?? e.root_cause?.[0]?.reason].filter(Boolean).join(': ');
}
