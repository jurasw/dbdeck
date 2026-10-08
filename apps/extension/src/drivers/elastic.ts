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
  search?: string;
}

export function searchQuery(text: string): Record<string, unknown> {
  const terms = text
    .trim()
    .split(/\s+/)
    .map((t) => `*${t.replace(/[+\-=&|><!(){}[\]^"~*?:\\/]/g, '\\$&')}*`);
  return { query_string: { query: terms.join(' '), default_field: '*', default_operator: 'AND', lenient: true, analyze_wildcard: true } };
}

export function kibanaEndpoints(url: string): { kibana: string; direct?: string } {
  let u: URL;
  try {
    if (!url.trim()) throw new Error();
    u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error();
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS Kibana URL, such as https://kibana.example.com.');
  }
  const cut = u.pathname.search(/\/(s\/[^/]+(?:\/|$)|(?:app|login|api)(?:\/|$))/);
  const kibana = `${u.origin}${(cut >= 0 ? u.pathname.slice(0, cut) : u.pathname).replace(/\/+$/, '')}`;
  const cloud = u.hostname.match(/^([^.]+)\.kb\.(.+\.(?:cloud\.es\.io|elastic-cloud\.com))$/);
  return { kibana, direct: cloud ? `${u.protocol}//${cloud[1]}.es.${cloud[2]}${u.port ? `:${u.port}` : ''}` : undefined };
}

export function elasticApiKey(value: string): string {
  const key = value.trim().replace(/^ApiKey\s+/i, '');
  if (!key) throw new Error('Paste the Encoded API key from Kibana.');
  if (/\s/.test(key)) throw new Error('Paste only the Encoded API key, without the request headers.');
  return key.includes(':') ? Buffer.from(key).toString('base64') : key;
}

const HEALTH_COLOR: Record<string, string> = { green: 'charts.green', yellow: 'charts.yellow', red: 'charts.red' };

export class ElasticDriver extends BaseDriver {
  private base = '';
  private kibana = '';
  version = '';

  async connect(): Promise<void> {
    if (this.config.kibanaUrl) return this.connectKibana(this.config.kibanaUrl);
    const { host, port } = await this.endpoint(9200);
    const proto = this.config.ssl ? 'https' : 'http';
    this.base = `${proto}://${host.includes(':') ? `[${host}]` : host}:${port}`;
    const r = await this.request('GET', '/');
    if (r.status >= 400) throw new Error(errorText(r.body) || `HTTP ${r.status}`);
    this.version = (r.body as { version?: { number?: string } })?.version?.number ?? '';
    if (typeof this.version !== 'string' || !this.version)
      throw new Error('The server did not return Elasticsearch cluster information. Check the Elasticsearch host or choose Kibana URL.');
  }

  private async connectKibana(url: string): Promise<void> {
    if (!this.config.apiKey?.trim())
      throw new Error('Open Kibana API keys, sign in in your browser, create a Personal API key and paste its Encoded value into the API key field.');
    const { kibana, direct } = kibanaEndpoints(url);
    if (direct) {
      this.base = direct;
      const r = await this.request('GET', '/').catch(() => undefined);
      if (r && r.status < 400) {
        this.version = (r.body as { version?: { number?: string } })?.version?.number ?? '';
        if (typeof this.version === 'string' && this.version) return;
      }
      this.base = '';
    }
    this.kibana = kibana;
    const r = await this.request('GET', '/');
    if (r.status === 401) throw new Error('Kibana rejected the API key. Paste the Encoded value of a valid Personal API key created in this Kibana instance.');
    if (r.status === 403)
      throw new Error(
        'Kibana denied access (HTTP 403). The API key needs Elasticsearch access and the Kibana Dev Tools privilege. Ask your administrator to check these permissions.',
      );
    if (r.status === 404)
      throw new Error(
        'Kibana console proxy was not found (HTTP 404). Check the Kibana URL and base path, and whether Dev Tools is enabled. You can also connect to the Elasticsearch host directly.',
      );
    if (r.status >= 400) throw new Error(errorText(r.body) || `HTTP ${r.status}`);
    this.version = (r.body as { version?: { number?: string } })?.version?.number ?? '';
    if (typeof this.version !== 'string' || !this.version)
      throw new Error('Kibana did not return Elasticsearch cluster information. Check the Kibana URL and whether its console proxy is enabled.');
  }

  protected async disconnect(): Promise<void> {
    this.base = '';
    this.kibana = '';
  }

  async request(method: string, path: string, body?: unknown): Promise<EsResponse> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.config.apiKey) headers.authorization = `ApiKey ${elasticApiKey(this.config.apiKey)}`;
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
    const target = path.startsWith('/') ? path : `/${path}`;
    if (this.kibana) {
      headers['kbn-xsrf'] = 'true';
      headers['content-type'] ??= 'application/json';
    }
    const r = await httpRequest({
      method: this.kibana ? 'POST' : method.toUpperCase(),
      url: this.kibana ? `${this.kibana}/api/console/proxy?${new URLSearchParams({ path: target, method: method.toUpperCase() })}` : this.base + target,
      headers,
      body: payload ?? (this.kibana ? '' : undefined),
      rejectUnauthorized: this.config.rejectUnauthorized ?? !!this.config.kibanaUrl,
    });
    const durationMs = Date.now() - t;
    if ((r.status >= 300 && r.status < 400) || /text\/html/i.test(String(r.headers['content-type'] ?? '')) || /^\s*<(?:!doctype\s+html|html)\b/i.test(r.body)) {
      throw new Error(
        this.kibana
          ? 'Kibana returned a browser login page or redirect instead of Elasticsearch data. Browser sign-in does not sign DBDeck in. Use a Personal API key; if a sign-in proxy blocks API requests, ask your administrator for API access or the direct Elasticsearch URL.'
          : 'The server returned a browser page or redirect instead of Elasticsearch data. Use the Elasticsearch endpoint, or choose Kibana URL in the connection form.',
      );
    }
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
      return fields.map((f) => this.node('esField', f.name, { table: n.table, description: f.type, icon: 'symbol-field', leaf: true, tags: 'esField' }));
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
    if (o.search?.trim()) body.query = { bool: { must: [body.query ?? { match_all: {} }, searchQuery(o.search)] } };
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
    const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? docs.length);
    return { ...grid, durationMs: r.durationMs, total, message: `took ${res.took} ms` };
  }
}

export function errorText(body: unknown): string {
  if (typeof body === 'string') return body;
  const response = body as { message?: string; error?: { reason?: string; type?: string; root_cause?: { reason?: string }[] } | string } | undefined;
  const e = response?.error;
  if (!e) return typeof response?.message === 'string' ? response.message : '';
  if (typeof e === 'string') return e;
  return [e.type, e.reason ?? e.root_cause?.[0]?.reason].filter(Boolean).join(': ');
}
