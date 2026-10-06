import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DbNode } from '../types';
import { formatBytes, formatCount } from '../util';
import { BaseDriver } from './base';

const LIST_LIMIT = 2000;

export class S3Driver extends BaseDriver {
  private s3?: S3Client;

  get client(): S3Client {
    if (!this.s3) throw new Error('Not connected');
    return this.s3;
  }

  async connect(): Promise<void> {
    const c = this.config;
    this.s3 = new S3Client({
      region: c.region || 'us-east-1',
      endpoint: c.endpoint || undefined,
      forcePathStyle: !!c.forcePathStyle,
      followRegionRedirects: true,
      credentials: c.user ? { accessKeyId: c.user, secretAccessKey: c.password ?? '' } : undefined,
      requestHandler: { httpsAgent: new https.Agent({ rejectUnauthorized: c.rejectUnauthorized ?? true }) },
    });
    if (c.database) await this.s3.send(new HeadBucketCommand({ Bucket: c.database }));
    else await this.s3.send(new ListBucketsCommand({}));
  }

  protected async disconnect(): Promise<void> {
    this.s3?.destroy();
    this.s3 = undefined;
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const names = this.config.database
        ? [this.config.database]
        : ((await this.client.send(new ListBucketsCommand({}))).Buckets ?? []).map((b) => b.Name!).filter(Boolean);
      return names.map((b) => this.node('s3Bucket', b, { database: b, prefix: '', icon: 'archive', tags: 's3Bucket s3' }));
    }
    if (n.kind !== 's3Bucket' && n.kind !== 's3Prefix') return [];
    const bucket = n.database!;
    const prefix = n.prefix ?? '';
    const folders: DbNode[] = [];
    const files: DbNode[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: token }));
      for (const p of r.CommonPrefixes ?? []) {
        if (!p.Prefix) continue;
        folders.push(this.node('s3Prefix', p.Prefix.slice(prefix.length).replace(/\/$/, ''), { database: bucket, prefix: p.Prefix, icon: 'folder', tags: 's3Prefix s3' }));
      }
      for (const o of r.Contents ?? []) {
        if (!o.Key || o.Key === prefix) continue;
        files.push(
          this.node('s3Object', o.Key.slice(prefix.length), {
            database: bucket,
            key: o.Key,
            leaf: true,
            icon: 'file',
            description: formatBytes(o.Size ?? 0),
            tooltip: `s3://${bucket}/${o.Key}\n${formatBytes(o.Size ?? 0)}${o.LastModified ? `\n${o.LastModified.toISOString()}` : ''}`,
            tags: 's3Object s3',
            extra: { size: o.Size ?? 0 },
          }),
        );
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token && folders.length + files.length < LIST_LIMIT);
    const out = [...folders, ...files];
    if (token) out.push(this.node('info', `showing first ${formatCount(out.length)} entries`, { icon: 'info', leaf: true }));
    return out;
  }

  async download(bucket: string, key: string, file: string): Promise<void> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await pipeline(r.Body as Readable, fs.createWriteStream(file));
  }

  async upload(bucket: string, key: string, file: string): Promise<void> {
    this.assertWritable();
    const { size } = await fs.promises.stat(file);
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: fs.createReadStream(file), ContentLength: size }));
  }

  async remove(bucket: string, key: string): Promise<void> {
    this.assertWritable();
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async removePrefix(bucket: string, prefix: string): Promise<number> {
    this.assertWritable();
    let total = 0;
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (r.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
        total += keys.length;
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return total;
  }

  private assertWritable(): void {
    if (this.config.readonly) throw new Error('This connection is read-only');
  }
}
