export type UrlType = 'postgres' | 'mysql' | 'sqlite' | 'clickhouse' | 'redis';

export interface ParsedConnectionUrl {
  type: UrlType;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  rejectUnauthorized?: boolean;
}

const SCHEMES: Record<string, UrlType> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  file: 'sqlite',
  clickhouse: 'clickhouse',
  redis: 'redis',
  rediss: 'redis',
};

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const truthy = (v: string) => !/^(0|false|off|no|disable|disabled)$/i.test(v);

function sslOptions(params: URLSearchParams): Pick<ParsedConnectionUrl, 'ssl' | 'rejectUnauthorized'> {
  const mode = (params.get('sslmode') ?? params.get('ssl-mode') ?? '').toLowerCase();
  if (mode === 'disable' || mode === 'disabled' || mode === 'allow' || mode === 'prefer' || mode === 'preferred') return { ssl: false };
  if (mode === 'verify-ca' || mode === 'verify-full' || mode === 'verify_ca' || mode === 'verify_identity') return { ssl: true, rejectUnauthorized: true };
  if (mode) return { ssl: true, rejectUnauthorized: false };
  const accept = params.get('sslaccept')?.toLowerCase();
  if (accept === 'strict') return { ssl: true, rejectUnauthorized: true };
  if (accept) return { ssl: true, rejectUnauthorized: false };
  const ssl = params.get('ssl') ?? params.get('tls') ?? params.get('secure') ?? params.get('useSSL');
  if (ssl === null) return {};
  if (ssl.trim().startsWith('{')) {
    try {
      const options = JSON.parse(ssl) as { rejectUnauthorized?: boolean };
      return { ssl: true, rejectUnauthorized: options.rejectUnauthorized !== false };
    } catch {
      return { ssl: true };
    }
  }
  return { ssl: truthy(ssl) };
}

function sqlitePath(rest: string): string {
  let path = decode(rest.replace(/[?#].*$/, ''));
  if (path.startsWith('localhost/')) path = path.slice('localhost'.length);
  path = path.replace(/^\/{2,}/, '/');
  if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
  return path;
}

export function parseConnectionUrl(text: string): ParsedConnectionUrl | undefined {
  const value = text.trim();
  const match = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(value);
  if (!match) return undefined;
  const scheme = match[1].toLowerCase().replace(/\+.*$/, '');
  const type = SCHEMES[scheme];
  if (!type) return undefined;
  if (type === 'sqlite') {
    const database = sqlitePath(value.slice(match[0].length));
    return database ? { type, database } : undefined;
  }
  if (!match[2]) return undefined;
  let url: URL;
  try {
    url = new URL(value.replace(/^[^:]+:/, 'http:'));
  } catch {
    return undefined;
  }
  const authority = value.slice(match[0].length).split(/[/?#]/, 1)[0];
  const portText = /:(\d+)$/.exec(authority.slice(authority.lastIndexOf('@') + 1))?.[1];
  const params = url.searchParams;
  const host = params.get('host') ?? decode(url.hostname.replace(/^\[|\]$/g, ''));
  const user = params.get('user') ?? params.get('username') ?? decode(url.username);
  const password = params.get('password') ?? decode(url.password);
  const database = params.get('dbname') ?? params.get('database') ?? decode(url.pathname.replace(/^\//, '').replace(/\/$/, ''));
  const port = Number(params.get('port') ?? portText) || undefined;
  return {
    type,
    host: host || undefined,
    port,
    user: user || undefined,
    password: password || undefined,
    database: database || undefined,
    ...(scheme === 'rediss' ? { ssl: true } : {}),
    ...sslOptions(params),
  };
}
