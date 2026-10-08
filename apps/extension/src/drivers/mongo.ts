import * as vm from 'vm';
import { Binary, Decimal128, Document, EJSON, Int32, Long, ObjectId, Timestamp, UUID } from 'bson';
import { MongoClient } from 'mongodb';
import { DbNode, QueryResult, ValueMatch, ValueSearchPage } from '../types';
import { formatBytes, formatCount } from '../util';
import { BaseDriver } from './base';

const SYSTEM_DBS = new Set(['admin', 'config', 'local']);
const MAX_DOCS = 1000;

export interface FindOptions {
  filter?: string;
  sort?: string;
  projection?: string;
  skip: number;
  limit: number;
  search?: string;
}

export function matchesValue(value: unknown, search: string): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((v) => matchesValue(v, search));
  if (typeof value === 'object') return Object.values(value).some((v) => matchesValue(v, search));
  return String(value).toLocaleLowerCase().includes(search.toLocaleLowerCase());
}

export function matchingValues(value: unknown, search: string, path = ''): ValueMatch[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => matchingValues(child, search, path ? `${path}.${key}` : key));
  }
  return matchesValue(value, search) ? [{ column: path, value: String(value) }] : [];
}

export async function scanValues<T>(source: AsyncIterable<T>, search: string, skip: number, limit: number, plain: (doc: T) => unknown): Promise<{ docs: T[]; total: number }> {
  const docs: T[] = [];
  let total = 0;
  for await (const doc of source) {
    if (!matchesValue(plain(doc), search)) continue;
    if (total >= skip && docs.length < limit) docs.push(doc);
    total++;
  }
  return { docs, total };
}

export function parseRelaxed(text: string | undefined): Document {
  const t = text?.trim();
  if (!t) return {};
  try {
    return EJSON.parse(t, { relaxed: true }) as Document;
  } catch {
    const v = vm.runInNewContext(`(${t})`, shellGlobals(), { timeout: 1000 });
    return EJSON.parse(EJSON.stringify(v, { relaxed: false }), { relaxed: false }) as Document;
  }
}

function shellGlobals(): Record<string, unknown> {
  return {
    ObjectId: (id?: string) => new ObjectId(id),
    ISODate: (d?: string) => (d ? new Date(d) : new Date()),
    Date,
    NumberLong: (v: string | number) => Long.fromString(String(v)),
    NumberInt: (v: number) => new Int32(v),
    NumberDecimal: (v: string) => Decimal128.fromString(String(v)),
    Timestamp: (t: number, i: number) => new Timestamp({ t, i }),
    UUID: (v?: string) => new UUID(v),
    BinData: (sub: number, b64: string) => new Binary(Buffer.from(b64, 'base64'), sub),
    RegExp,
  };
}

export function toPlain(doc: unknown): unknown {
  return relax(EJSON.serialize(doc, { relaxed: false }));
}

function relax(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(relax);
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 1) {
    const [k] = keys;
    const x = o[k];
    if (k === '$numberInt') return Number(x);
    if (k === '$numberDouble') return /^-?(Infinity|NaN)$/.test(String(x)) ? o : Number(x);
    if (k === '$numberLong') return Number.isSafeInteger(Number(x)) ? Number(x) : o;
    if (k === '$date') {
      const ms = Number((x as { $numberLong?: string })?.$numberLong ?? NaN);
      const d = new Date(ms);
      return isNaN(d.getTime()) || d.getUTCFullYear() < 1970 || d.getUTCFullYear() > 9999 ? o : { $date: d.toISOString() };
    }
  }
  return Object.fromEntries(keys.map((k) => [k, relax(o[k])]));
}

export class MongoDriver extends BaseDriver {
  private client?: MongoClient;

  async connect(): Promise<void> {
    let uri = this.config.useUri && this.config.uri ? this.config.uri : '';
    if (!uri) {
      const { host, port } = await this.endpoint(27017);
      const auth = this.config.user ? `${encodeURIComponent(this.config.user)}:${encodeURIComponent(this.config.password ?? '')}@` : '';
      const qs = new URLSearchParams({ directConnection: 'true' });
      if (this.config.user) qs.set('authSource', this.config.authSource || 'admin');
      if (this.config.ssl) qs.set('tls', 'true');
      if (this.config.ssl && this.config.rejectUnauthorized === false) qs.set('tlsAllowInvalidCertificates', 'true');
      uri = `mongodb://${auth}${host.includes(':') ? `[${host}]` : host}:${port}/?${qs}`;
    }
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: 'DBDeck' });
    await this.client.connect();
  }

  protected async disconnect(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
  }

  private get defaultDb(): string | undefined {
    if (this.config.database) return this.config.database;
    if (this.config.useUri && this.config.uri) {
      const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(this.config.uri);
      if (m) return decodeURIComponent(m[1]);
    }
    return undefined;
  }

  db(name: string) {
    return this.client!.db(name);
  }

  async databases(): Promise<string[]> {
    try {
      const r = await this.client!.db('admin').admin().listDatabases({ nameOnly: true });
      return r.databases
        .map((d) => d.name)
        .filter((d) => this.config.showSystem || !SYSTEM_DBS.has(d))
        .sort();
    } catch (e) {
      if (this.defaultDb) return [this.defaultDb];
      throw e;
    }
  }

  async collections(db: string): Promise<string[]> {
    const cols = await this.db(db).listCollections({}, { nameOnly: true }).toArray();
    return cols.map((c) => c.name).sort();
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const dbs = await this.databases();
      return dbs.map((d) => this.node('database', d, { database: d, icon: 'database', tags: 'database mongo', expanded: d === this.defaultDb }));
    }
    if (n.kind === 'database') {
      const cols = await this.db(n.database!).listCollections({}).toArray();
      const visible = cols.filter((c) => this.config.showSystem || !c.name.startsWith('system.'));
      const counts = await Promise.all(
        visible.map((c) =>
          c.type === 'view'
            ? Promise.resolve(-1)
            : this.db(n.database!)
                .collection(c.name)
                .estimatedDocumentCount()
                .catch(() => -1),
        ),
      );
      return visible
        .map((c, i) => ({ c, count: counts[i] }))
        .sort((a, b) => a.c.name.localeCompare(b.c.name))
        .map(({ c, count }) =>
          this.node('collection', c.name, {
            database: n.database,
            table: c.name,
            icon: c.type === 'view' ? 'eye' : 'symbol-array',
            description: count >= 0 ? `${formatCount(count)} docs` : c.type,
            tags: 'collection mongo',
          }),
        );
    }
    if (n.kind === 'collection') {
      const idx = await this.db(n.database!).collection(n.table!).indexes();
      return idx.map((i) =>
        this.node('info', i.name ?? '', {
          database: n.database,
          table: n.table,
          description: JSON.stringify(i.key) + (i.unique ? ' · unique' : ''),
          icon: 'list-tree',
          leaf: true,
          tags: 'index',
        }),
      );
    }
    return [];
  }

  async find(db: string, coll: string, o: FindOptions): Promise<{ docs: unknown[]; durationMs: number; total?: number }> {
    const t = Date.now();
    let cur = this.db(db).collection(coll).find(parseRelaxed(o.filter));
    const sort = parseRelaxed(o.sort);
    if (Object.keys(sort).length) cur = cur.sort(sort);
    const proj = parseRelaxed(o.projection);
    if (o.search?.trim()) {
      try {
        const result = await scanValues(cur, o.search.trim(), o.skip, o.limit, toPlain);
        const docs = Object.keys(proj).length
          ? await Promise.all(result.docs.map((doc) => this.db(db).collection(coll).findOne({ _id: doc._id }, { projection: proj })))
          : result.docs;
        return { docs: docs.map(toPlain), total: result.total, durationMs: Date.now() - t };
      } finally {
        await cur.close();
      }
    }
    if (Object.keys(proj).length) cur = cur.project(proj);
    const docs = await cur.skip(o.skip).limit(o.limit).toArray();
    return { docs: docs.map(toPlain), durationMs: Date.now() - t };
  }

  async count(db: string, coll: string, filter?: string, search?: string): Promise<number> {
    const f = parseRelaxed(filter);
    const c = this.db(db).collection(coll);
    if (search?.trim()) {
      const cursor = c.find(f);
      try {
        return (await scanValues(cursor, search.trim(), 0, 0, toPlain)).total;
      } finally {
        await cursor.close();
      }
    }
    return Object.keys(f).length ? c.countDocuments(f) : c.estimatedDocumentCount();
  }

  async searchValues(db: string, coll: string, search: string, cancelled: () => boolean): Promise<ValueSearchPage> {
    const matches: ValueMatch[] = [];
    if (!search.trim() || cancelled()) return { matches, limited: false };
    const cursor = this.db(db).collection(coll).find({}).maxTimeMS(30000);
    let rows = 0;
    try {
      for await (const doc of cursor) {
        if (cancelled()) return { matches: [], limited: false };
        const values = matchingValues(toPlain(doc), search.trim());
        if (!values.length) continue;
        if (++rows > 20) return { matches, limited: true };
        matches.push(...values);
      }
      return { matches, limited: false };
    } finally {
      await cursor.close();
    }
  }

  async replace(db: string, coll: string, id: unknown, text: string): Promise<void> {
    if (this.config.readonly) throw new Error('This connection is read-only');
    const doc = EJSON.parse(text, { relaxed: true }) as Document;
    const _id = EJSON.deserialize({ v: id } as Document, { relaxed: true }).v;
    delete doc._id;
    const r = await this.db(db).collection(coll).replaceOne({ _id }, doc);
    if (!r.matchedCount) throw new Error('Document not found');
  }

  async updateField(db: string, coll: string, id: unknown, field: string, text: string): Promise<void> {
    if (this.config.readonly) throw new Error('This connection is read-only');
    if (!field || field === '_id' || field.startsWith('$') || field.includes('.') || field.includes('\0')) throw new Error('This field cannot be edited inline');
    if (id === undefined) throw new Error('Document ID is missing');
    const _id = EJSON.deserialize({ v: id } as Document, { relaxed: true }).v;
    const value = EJSON.parse(text, { relaxed: true });
    const r = await this.db(db)
      .collection(coll)
      .updateOne({ _id }, { $set: { [field]: value } });
    if (!r.matchedCount) throw new Error('Document not found');
  }

  async insert(db: string, coll: string, text: string): Promise<void> {
    if (this.config.readonly) throw new Error('This connection is read-only');
    const parsed = EJSON.parse(text, { relaxed: true }) as Document | Document[];
    const c = this.db(db).collection(coll);
    if (Array.isArray(parsed)) await c.insertMany(parsed);
    else await c.insertOne(parsed);
  }

  async remove(db: string, coll: string, ids: unknown[]): Promise<number> {
    if (this.config.readonly) throw new Error('This connection is read-only');
    const _ids = ids.map((id) => EJSON.deserialize({ v: id } as Document, { relaxed: true }).v);
    const r = await this.db(db)
      .collection(coll)
      .deleteMany({ _id: { $in: _ids } });
    return r.deletedCount;
  }

  async stats(db: string, coll: string): Promise<string> {
    const s = await this.db(db).command({ collStats: coll });
    return `${formatCount(s.count ?? 0)} docs · ${formatBytes(s.size ?? 0)} data · ${formatBytes(s.totalIndexSize ?? 0)} indexes`;
  }

  async fields(db: string, coll: string): Promise<{ name: string; type: string }[]> {
    const docs = await this.db(db)
      .collection(coll)
      .aggregate([{ $sample: { size: 100 } }], { maxTimeMS: 10000 })
      .toArray();
    const types = new Map<string, Set<string>>();
    const walk = (doc: Document, prefix: string, depth: number) => {
      for (const [key, value] of Object.entries(doc)) {
        const name = prefix + key;
        const type = bsonType(value);
        if (!types.has(name)) types.set(name, new Set());
        types.get(name)!.add(type);
        if (type === 'object' && depth < 2) walk(value as Document, `${name}.`, depth + 1);
      }
    };
    for (const doc of docs) walk(doc, '', 0);
    return [...types].slice(0, 300).map(([name, t]) => ({ name, type: [...t].join(' | ') }));
  }

  async readOnly(db: string, text: string): Promise<QueryResult> {
    const spec = EJSON.parse(text, { relaxed: true }) as { collection?: unknown; filter?: Document; sort?: Document; projection?: Document; limit?: unknown; pipeline?: unknown };
    if (!spec || typeof spec !== 'object' || typeof spec.collection !== 'string' || !spec.collection)
      throw new Error('Pass {"collection": "...", "filter": {...}} or {"collection": "...", "pipeline": [...]}.');
    const limit = Math.min(Math.max(Math.floor(Number(spec.limit)) || 100, 1), MAX_DOCS);
    const coll = this.db(db).collection(spec.collection);
    const t = Date.now();
    let docs: Document[];
    if (spec.pipeline !== undefined) {
      if (!Array.isArray(spec.pipeline)) throw new Error('pipeline must be an array of stages.');
      if (writesData(spec.pipeline)) throw new Error('$out and $merge stages cannot run here.');
      docs = await coll.aggregate([...(spec.pipeline as Document[]), { $limit: limit }], { maxTimeMS: 30000 }).toArray();
    } else {
      docs = await coll.find(spec.filter ?? {}, { projection: spec.projection, sort: spec.sort, limit, maxTimeMS: 30000 }).toArray();
    }
    const plain = docs.map(toPlain);
    return { ...docsToGrid(plain), json: plain, durationMs: Date.now() - t };
  }

  async script(dbName: string, code: string): Promise<QueryResult> {
    const logs: string[] = [];
    let current = dbName;
    const client = this.client!;
    const wrapCursor = (c: object): unknown =>
      new Proxy(c, {
        get(target, prop, recv) {
          if (prop === 'pretty') return () => recv;
          if (prop === 'count') return () => (target as { count?: () => Promise<number> }).count?.();
          const v = Reflect.get(target, prop, target);
          if (typeof v !== 'function') return v;
          return (...args: unknown[]) => {
            const r = v.apply(target, args);
            return r === target ? recv : r;
          };
        },
      });
    const wrapColl = (name: string) => {
      const coll = client.db(current).collection(name);
      return new Proxy(coll, {
        get(target, prop) {
          if (prop === 'find' || prop === 'aggregate' || prop === 'listIndexes')
            return (...args: unknown[]) => wrapCursor((target[prop] as (...a: unknown[]) => object).apply(target, args));
          if (prop === 'getIndexes') return () => target.indexes();
          if (prop === 'count') return (f?: Document) => target.countDocuments(f ?? {});
          if (prop === 'insert') return (d: Document | Document[]) => (Array.isArray(d) ? target.insertMany(d) : target.insertOne(d));
          if (prop === 'remove') return (f: Document) => target.deleteMany(f);
          const v = Reflect.get(target, prop, target);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    };
    const special: Record<string, unknown> = {
      getName: () => current,
      getCollection: (n: string) => wrapColl(n),
      getCollectionNames: () =>
        client
          .db(current)
          .listCollections({}, { nameOnly: true })
          .toArray()
          .then((l) => l.map((c) => c.name)),
      getSiblingDB: (n: string) => {
        current = n;
        return dbProxy;
      },
      runCommand: (cmd: Document) => client.db(current).command(cmd),
      adminCommand: (cmd: Document) => client.db('admin').command(cmd),
      stats: () => client.db(current).stats(),
      createCollection: (n: string, o?: Document) =>
        client
          .db(current)
          .createCollection(n, o)
          .then(() => ({ ok: 1 })),
      dropDatabase: () => client.db(current).dropDatabase(),
    };
    const dbProxy: unknown = new Proxy({}, { get: (_t, p) => (typeof p === 'string' ? (p in special ? special[p] : wrapColl(p)) : undefined) });
    const log = (...a: unknown[]) => logs.push(a.map((x) => (typeof x === 'string' ? x : EJSON.stringify(x, undefined, 2, { relaxed: true }))).join(' '));
    const ctx = vm.createContext({
      ...shellGlobals(),
      db: dbProxy,
      use: (n: string) => {
        current = n;
        return `switched to db ${n}`;
      },
      print: log,
      printjson: log,
      console: { log, info: log, warn: log, error: log },
    });
    const t = Date.now();
    let value = new vm.Script(code, { filename: 'query.mongodb' }).runInContext(ctx, { timeout: 30000 });
    if (value && typeof (value as { then?: unknown }).then === 'function') value = await value;
    let docs: unknown[] | undefined;
    if (value && typeof (value as { toArray?: unknown }).toArray === 'function') {
      docs = [];
      for await (const d of value as AsyncIterable<unknown>) {
        docs.push(d);
        if (docs.length >= MAX_DOCS) break;
      }
      await (value as { close?: () => Promise<void> }).close?.();
    } else if (Array.isArray(value)) docs = value;
    const durationMs = Date.now() - t;
    if (docs) {
      const plain = docs.map(toPlain);
      return { ...docsToGrid(plain), durationMs, json: plain, truncated: docs.length >= MAX_DOCS, message: logs.join('\n') || undefined };
    }
    const plain = value === undefined ? undefined : toPlain(value);
    return { columns: [], rows: [], durationMs, json: plain, message: logs.join('\n') || (plain === undefined ? 'OK' : undefined) };
  }
}

function bsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value && typeof value === 'object') return (value as { _bsontype?: string })._bsontype ?? 'object';
  return typeof value;
}

export function writesData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(writesData);
  return !!value && typeof value === 'object' && Object.entries(value).some(([key, child]) => key === '$out' || key === '$merge' || writesData(child));
}

export function docsToGrid(docs: unknown[]): { columns: { name: string }[]; rows: unknown[][] } {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      for (const k of Object.keys(d)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
  }
  if (!keys.length) return { columns: [{ name: 'value' }], rows: docs.map((d) => [d]) };
  return { columns: keys.map((name) => ({ name })), rows: docs.map((d) => keys.map((k) => (d as Record<string, unknown>)?.[k] ?? undefined)) };
}
