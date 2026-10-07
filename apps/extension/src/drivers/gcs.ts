import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { Readable } from 'stream';
import { ReadableStream } from 'stream/web';
import { pipeline } from 'stream/promises';
import { listBuckets } from '../google-storage';
import { ConnectionConfig, DbNode } from '../types';
import { formatBytes, formatCount, formatDate } from '../util';
import { BaseDriver } from './base';

const LIST_LIMIT = 2000;
const DELETE_CONCURRENCY = 8;

interface ObjectList {
  prefixes?: string[];
  items?: { name: string; size?: string; updated?: string }[];
  nextPageToken?: string;
}

export class GcsDriver extends BaseDriver {
  constructor(
    config: ConnectionConfig,
    private readonly accessToken: () => Promise<string>,
    private readonly base = 'https://storage.googleapis.com',
  ) {
    super(config);
  }

  private get who(): string {
    return this.config.googleEmail ?? 'Your Google account';
  }

  private async call(url: string, what: string, init: RequestInit = {}, timeout = 30000): Promise<Response> {
    const r = await fetch(this.base + url, {
      ...init,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, ...init.headers },
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    });
    if (!r.ok) throw this.failure(r.status, await r.text(), what);
    return r;
  }

  private failure(status: number, text: string, what: string): Error {
    let message: string;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text.trim();
    } catch {
      message = text.trim();
    }
    if (status === 401) return new Error('Google sign-in expired. Edit the connection and click Sign in with Google.');
    if (status === 403) return new Error(`${this.who} has no access to ${what}. ${message}`.trim());
    if (status === 404) return new Error(`${what[0].toUpperCase()}${what.slice(1)} not found.`);
    return new Error(`${what}: ${message || `HTTP ${status}`}`);
  }

  private bucketPath(bucket: string): string {
    return `/storage/v1/b/${encodeURIComponent(bucket)}`;
  }

  private objectPath(bucket: string, key: string): string {
    return `${this.bucketPath(bucket)}/o/${encodeURIComponent(key)}`;
  }

  async connect(): Promise<void> {
    const c = this.config;
    if (c.database) await this.call(`${this.bucketPath(c.database)}?fields=name`, `bucket ${c.database}`);
    else if (c.project) await this.call(`/storage/v1/b?${new URLSearchParams({ project: c.project, maxResults: '1', fields: 'items(name)' })}`, `project ${c.project}`);
    else throw new Error('Choose a bucket in Options › Google Cloud Storage.');
  }

  protected async disconnect(): Promise<void> {}

  private async list(bucket: string, prefix: string, delimiter: boolean, page: string): Promise<ObjectList> {
    const q = new URLSearchParams({
      prefix,
      maxResults: '1000',
      fields: 'prefixes,items(name,size,updated),nextPageToken',
      ...(delimiter ? { delimiter: '/' } : {}),
      ...(page ? { pageToken: page } : {}),
    });
    return (await (await this.call(`${this.bucketPath(bucket)}/o?${q}`, `bucket ${bucket}`)).json()) as ObjectList;
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const names = this.config.database ? [this.config.database] : await listBuckets(await this.accessToken(), this.config.project!, this.base);
      return names.map((b) => this.node('s3Bucket', b, { database: b, prefix: '', icon: 'archive', tags: 's3Bucket s3' }));
    }
    if (n.kind !== 's3Bucket' && n.kind !== 's3Prefix') return [];
    const bucket = n.database!;
    const prefix = n.prefix ?? '';
    const folders: DbNode[] = [];
    const files: DbNode[] = [];
    let page = '';
    do {
      const r = await this.list(bucket, prefix, true, page);
      for (const p of r.prefixes ?? [])
        folders.push(this.node('s3Prefix', p.slice(prefix.length).replace(/\/$/, ''), { database: bucket, prefix: p, icon: 'folder', tags: 's3Prefix s3' }));
      for (const o of r.items ?? []) {
        if (o.name === prefix) continue;
        const size = Number(o.size ?? 0);
        files.push(
          this.node('s3Object', o.name.slice(prefix.length), {
            database: bucket,
            key: o.name,
            leaf: true,
            icon: 'file',
            description: formatBytes(size),
            tooltip: `gs://${bucket}/${o.name}\n${formatBytes(size)}${o.updated ? `\nmodified ${formatDate(o.updated)}` : ''}`,
            tags: 's3Object s3',
            extra: { size },
          }),
        );
      }
      page = r.nextPageToken ?? '';
    } while (page && folders.length + files.length < LIST_LIMIT);
    const out = [...folders, ...files];
    if (page) out.push(this.node('info', `showing first ${formatCount(out.length)} entries`, { icon: 'info', leaf: true }));
    return out;
  }

  async download(bucket: string, key: string, file: string): Promise<void> {
    const r = await this.call(`${this.objectPath(bucket, key)}?alt=media`, `gs://${bucket}/${key}`, {}, 0);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await pipeline(Readable.fromWeb(r.body as ReadableStream), fs.createWriteStream(file));
  }

  async upload(bucket: string, key: string, file: string): Promise<void> {
    this.assertWritable();
    const { size } = await fs.promises.stat(file);
    const url = new URL(`${this.base}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
    url.search = new URLSearchParams({ uploadType: 'media', name: key }).toString();
    const token = await this.accessToken();
    const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = (url.protocol === 'http:' ? http : https).request(
        url,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': size } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      pipeline(fs.createReadStream(file), req).catch(reject);
    });
    if (status >= 300) throw this.failure(status, text, `gs://${bucket}/${key}`);
  }

  async remove(bucket: string, key: string): Promise<void> {
    this.assertWritable();
    await this.call(this.objectPath(bucket, key), `gs://${bucket}/${key}`, { method: 'DELETE' });
  }

  async removePrefix(bucket: string, prefix: string): Promise<number> {
    this.assertWritable();
    let total = 0;
    let page = '';
    do {
      const r = await this.list(bucket, prefix, false, page);
      const names = (r.items ?? []).map((o) => o.name);
      for (let i = 0; i < names.length; i += DELETE_CONCURRENCY) await Promise.all(names.slice(i, i + DELETE_CONCURRENCY).map((k) => this.remove(bucket, k)));
      total += names.length;
      page = r.nextPageToken ?? '';
    } while (page);
    return total;
  }

  private assertWritable(): void {
    if (this.config.readonly) throw new Error('This connection is read-only');
  }
}
