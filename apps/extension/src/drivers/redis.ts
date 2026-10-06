import Redis, { RedisOptions } from 'ioredis';
import * as vscode from 'vscode';
import { DbNode } from '../types';
import { BaseDriver } from './base';

const TYPE_ICON: Record<string, [string, string]> = {
  string: ['symbol-string', 'charts.blue'],
  hash: ['symbol-object', 'charts.purple'],
  list: ['list-ordered', 'charts.green'],
  set: ['symbol-array', 'charts.orange'],
  zset: ['list-filter', 'charts.yellow'],
  stream: ['pulse', 'charts.red'],
  'ReJSON-RL': ['json', 'charts.blue'],
};

export interface KeyValue {
  key: string;
  type: string;
  ttl: number;
  size: number;
  value: unknown;
  truncated?: boolean;
}

export class RedisDriver extends BaseDriver {
  private clients = new Map<number, Redis>();
  private options?: RedisOptions;
  private keyCache = new Map<number, string[]>();
  readonly filters = new Map<number, string>();

  async connect(): Promise<void> {
    const { host, port } = await this.endpoint(6379);
    this.options = {
      host,
      port,
      username: this.config.user || undefined,
      password: this.config.password || undefined,
      tls: this.config.ssl ? { rejectUnauthorized: this.config.rejectUnauthorized ?? false, servername: this.config.host } : undefined,
      lazyConnect: true,
      connectTimeout: 10000,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : 500),
      connectionName: 'DBDeck',
    };
    await this.client(Number(this.config.database || 0));
  }

  protected async disconnect(): Promise<void> {
    const cs = [...this.clients.values()];
    this.clients.clear();
    this.keyCache.clear();
    cs.forEach((c) => c.disconnect());
  }

  async client(db: number): Promise<Redis> {
    let c = this.clients.get(db);
    if (c) return c;
    c = new Redis({ ...this.options, db });
    c.on('error', () => undefined);
    await c.connect();
    this.clients.set(db, c);
    return c;
  }

  private get separator(): string {
    return vscode.workspace.getConfiguration('dbdeck').get<string>('redisKeySeparator') || ':';
  }

  async dbCount(): Promise<number> {
    const c = await this.client(0);
    try {
      const r = (await c.config('GET', 'databases')) as string[];
      return Number(r[1]) || 16;
    } catch {
      return 16;
    }
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const c = await this.client(0);
      const [count, info] = await Promise.all([this.dbCount(), c.info('keyspace')]);
      const keys = new Map<number, number>();
      for (const m of info.matchAll(/^db(\d+):keys=(\d+)/gm)) keys.set(Number(m[1]), Number(m[2]));
      const preferred = Number(this.config.database || 0);
      const out: DbNode[] = [];
      for (let i = 0; i < count; i++) {
        const k = keys.get(i) ?? 0;
        if (!this.config.showSystem && k === 0 && i !== preferred) continue;
        out.push(
          this.node('redisDb', `db${i}`, {
            database: String(i),
            description: `${k} keys${this.filters.get(i) ? ` · filter ${this.filters.get(i)}` : ''}`,
            icon: 'database',
            tags: 'redisDb redis',
            expanded: i === preferred,
          }),
        );
      }
      return out;
    }
    const db = Number(n.database);
    if (n.kind === 'redisDb') {
      const keys = await this.scan(db);
      this.keyCache.set(db, keys);
      return this.level(db, keys, '');
    }
    if (n.kind === 'redisFolder') {
      const keys = this.keyCache.get(db) ?? (await this.scan(db));
      return this.level(db, keys, n.prefix!);
    }
    return [];
  }

  private async scan(db: number): Promise<string[]> {
    const c = await this.client(db);
    const limit = vscode.workspace.getConfiguration('dbdeck').get<number>('redisScanLimit') || 5000;
    const pattern = this.filters.get(db) || '*';
    const keys = new Set<string>();
    let cursor = '0';
    do {
      const [next, batch] = await c.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
      cursor = next;
      for (const k of batch) keys.add(k);
    } while (cursor !== '0' && keys.size < limit);
    return [...keys].slice(0, limit).sort();
  }

  private async level(db: number, keys: string[], prefix: string): Promise<DbNode[]> {
    const sep = this.separator;
    const folders = new Map<string, number>();
    const leaves: string[] = [];
    for (const k of keys) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const i = rest.indexOf(sep);
      if (i > 0 && i < rest.length - sep.length) {
        const f = rest.slice(0, i);
        folders.set(f, (folders.get(f) ?? 0) + 1);
      } else leaves.push(k);
    }
    const c = await this.client(db);
    const shown = leaves.slice(0, 2000);
    const pipe = c.pipeline();
    shown.forEach((k) => pipe.type(k));
    const types = shown.length ? ((await pipe.exec()) ?? []).map((r) => String(r[1])) : [];
    const out: DbNode[] = [];
    for (const [f, count] of [...folders].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(
        this.node('redisFolder', f, {
          database: String(db),
          prefix: prefix + f + sep,
          description: String(count),
          icon: 'folder',
          tags: 'redisFolder redis',
        }),
      );
    }
    shown.forEach((k, i) => {
      const [icon, color] = TYPE_ICON[types[i]] ?? ['key', 'foreground'];
      out.push(
        this.node('redisKey', k.slice(prefix.length) || k, {
          database: String(db),
          key: k,
          description: types[i],
          tooltip: k,
          icon,
          color,
          leaf: true,
          tags: 'redisKey redis',
        }),
      );
    });
    return out;
  }

  async getKey(db: number, key: string): Promise<KeyValue> {
    const c = await this.client(db);
    const [type, ttl] = await Promise.all([c.type(key), c.ttl(key)]);
    let value: unknown = null;
    let size = 0;
    let truncated = false;
    const LIMIT = 1000;
    switch (type) {
      case 'string':
        value = await c.get(key);
        size = (value as string)?.length ?? 0;
        break;
      case 'hash': {
        size = await c.hlen(key);
        if (size <= LIMIT) value = await c.hgetall(key);
        else {
          const [, flat] = await c.hscan(key, '0', 'COUNT', LIMIT);
          value = Object.fromEntries(pairs(flat));
          truncated = true;
        }
        break;
      }
      case 'list':
        size = await c.llen(key);
        value = await c.lrange(key, 0, LIMIT - 1);
        truncated = size > LIMIT;
        break;
      case 'set': {
        size = await c.scard(key);
        if (size <= LIMIT) value = (await c.smembers(key)).sort();
        else {
          const [, members] = await c.sscan(key, '0', 'COUNT', LIMIT);
          value = members;
          truncated = true;
        }
        break;
      }
      case 'zset': {
        size = await c.zcard(key);
        const flat = await c.zrange(key, 0, LIMIT - 1, 'WITHSCORES');
        value = pairs(flat).map(([member, score]) => ({ member, score: Number(score) }));
        truncated = size > LIMIT;
        break;
      }
      case 'stream': {
        size = await c.xlen(key);
        const entries = await c.xrevrange(key, '+', '-', 'COUNT', 200);
        value = entries.map(([id, fields]) => ({ id, fields: Object.fromEntries(pairs(fields)) }));
        truncated = size > 200;
        break;
      }
      case 'ReJSON-RL':
        value = await c.call('JSON.GET', key);
        break;
      case 'none':
        throw new Error(`Key "${key}" does not exist`);
    }
    return { key, type, ttl, size, value, truncated };
  }

  async exec(db: number, args: string[]): Promise<unknown> {
    if (this.config.readonly && !READ_COMMANDS.has(args[0]?.toUpperCase())) throw new Error('This connection is read-only');
    const c = await this.client(db);
    const [cmd, ...rest] = args;
    return c.call(cmd, ...rest);
  }

  invalidate(db: number): void {
    this.keyCache.delete(db);
  }
}

function pairs(flat: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

const READ_COMMANDS = new Set([
  'GET',
  'MGET',
  'HGET',
  'HGETALL',
  'HKEYS',
  'HVALS',
  'HLEN',
  'LRANGE',
  'LLEN',
  'LINDEX',
  'SMEMBERS',
  'SCARD',
  'SISMEMBER',
  'ZRANGE',
  'ZCARD',
  'ZSCORE',
  'ZRANK',
  'XRANGE',
  'XREVRANGE',
  'XLEN',
  'TYPE',
  'TTL',
  'PTTL',
  'EXISTS',
  'KEYS',
  'SCAN',
  'HSCAN',
  'SSCAN',
  'ZSCAN',
  'INFO',
  'DBSIZE',
  'PING',
  'STRLEN',
  'GETRANGE',
  'OBJECT',
  'MEMORY',
  'CLIENT',
  'CONFIG',
  'SLOWLOG',
  'TIME',
  'JSON.GET',
]);
