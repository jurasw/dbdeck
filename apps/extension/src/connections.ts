import * as vscode from 'vscode';
import { BaseDriver } from './drivers/base';
import { BIGQUERY_SCOPE, BigQueryDriver } from './drivers/bigquery';
import { ClickHouseDriver } from './drivers/clickhouse';
import { DockerDriver } from './drivers/docker';
import { ElasticDriver } from './drivers/elastic';
import { GcsDriver } from './drivers/gcs';
import { MongoDriver } from './drivers/mongo';
import { MysqlDriver } from './drivers/mysql';
import { PostgresDriver } from './drivers/postgres';
import { RedisDriver } from './drivers/redis';
import { S3Driver } from './drivers/s3';
import { SnowflakeDriver } from './drivers/snowflake';
import { SqliteDriver } from './drivers/sqlite';
import { GoogleCredentials } from './google-credentials';
import { STORAGE_SCOPE } from './google-storage';
import { ConnectionConfig } from './types';

const LIST_KEY = 'dbdeck.connections';

interface Secrets {
  password?: string;
  uri?: string;
  apiKey?: string;
  sshPassword?: string;
  sshPassphrase?: string;
}

export function createDriver(c: ConnectionConfig): BaseDriver {
  switch (c.type) {
    case 'mysql':
      return new MysqlDriver(c);
    case 'postgres':
      return new PostgresDriver(c);
    case 'sqlite':
      return new SqliteDriver(c);
    case 'clickhouse':
      return new ClickHouseDriver(c);
    case 'bigquery':
      return new BigQueryDriver(c, new GoogleCredentials(c.keyFile, BIGQUERY_SCOPE));
    case 'snowflake':
      return new SnowflakeDriver(c);
    case 'mongodb':
      return new MongoDriver(c);
    case 'redis':
      return new RedisDriver(c);
    case 'elasticsearch':
      return new ElasticDriver(c);
    case 'docker':
      return new DockerDriver(c);
    case 's3':
      if (c.googleAuth) {
        const credentials = new GoogleCredentials(undefined, STORAGE_SCOPE);
        return new GcsDriver(c, () => credentials.token());
      }
      return new S3Driver(c);
  }
}

export class ConnectionStore {
  private session = new Map<string, Secrets>();

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  list(): ConnectionConfig[] {
    return this.ctx.globalState.get<ConnectionConfig[]>(LIST_KEY, []);
  }

  get(id: string): ConnectionConfig | undefined {
    return this.list().find((c) => c.id === id);
  }

  async full(id: string): Promise<ConnectionConfig | undefined> {
    const c = this.get(id);
    if (!c) return undefined;
    const raw = c.savePassword === false ? undefined : await this.ctx.secrets.get(`dbdeck.secret.${id}`);
    const s: Secrets = raw ? JSON.parse(raw) : (this.session.get(id) ?? {});
    return {
      ...c,
      password: s.password,
      uri: s.uri,
      apiKey: s.apiKey,
      ssh: c.ssh ? { ...c.ssh, password: s.sshPassword, passphrase: s.sshPassphrase } : undefined,
    };
  }

  async save(c: ConnectionConfig): Promise<void> {
    const s: Secrets = { password: c.password, uri: c.uri, apiKey: c.apiKey, sshPassword: c.ssh?.password, sshPassphrase: c.ssh?.passphrase };
    const plain: ConnectionConfig = { ...c, password: undefined, uri: undefined, apiKey: undefined };
    if (plain.ssh) plain.ssh = { ...plain.ssh, password: undefined, passphrase: undefined };
    const list = this.list();
    const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = plain;
    else list.push(plain);
    if (c.savePassword === false) {
      this.session.set(c.id, Object.fromEntries(Object.entries(s).filter(([, v]) => v)) as Secrets);
      await this.ctx.secrets.delete(`dbdeck.secret.${c.id}`);
    } else await this.ctx.secrets.store(`dbdeck.secret.${c.id}`, JSON.stringify(s));
    await this.ctx.globalState.update(LIST_KEY, list);
  }

  async remove(id: string): Promise<void> {
    await this.ctx.globalState.update(
      LIST_KEY,
      this.list().filter((c) => c.id !== id),
    );
    await this.ctx.secrets.delete(`dbdeck.secret.${id}`);
    this.session.delete(id);
  }

  async renameGroup(from: string, to: string): Promise<void> {
    await this.ctx.globalState.update(
      LIST_KEY,
      this.list().map((c) => (c.group === from ? { ...c, group: to } : c)),
    );
  }

  async askSecrets(c: ConnectionConfig): Promise<ConnectionConfig | undefined> {
    if (c.savePassword !== false) return c;
    const s = this.session.get(c.id) ?? {};
    const needsPassword =
      c.type !== 'docker' &&
      !c.googleAuth &&
      !(c.type === 'mongodb' && c.useUri) &&
      !(c.type === 'snowflake' && c.authMethod === 'keyPair') &&
      !!c.user &&
      s.password === undefined;
    const needsUri = c.type === 'mongodb' && c.useUri && !s.uri;
    const needsSsh = !!c.ssh?.enabled && c.ssh.authType === 'password' && s.sshPassword === undefined;
    if (needsUri) {
      const v = await vscode.window.showInputBox({ title: c.name, prompt: 'Connection string (kept in memory for this session only)', password: true, ignoreFocusOut: true });
      if (v === undefined) return undefined;
      s.uri = v;
    }
    if (needsPassword) {
      const v = await vscode.window.showInputBox({
        title: c.name,
        prompt: `${c.type === 's3' ? 'Secret access key' : c.type === 'snowflake' ? 'Programmatic access token' : 'Password'} for ${c.user} (kept in memory for this session only)`,
        password: true,
        ignoreFocusOut: true,
      });
      if (v === undefined) return undefined;
      s.password = v;
    }
    if (needsSsh) {
      const v = await vscode.window.showInputBox({ title: c.name, prompt: `SSH password for ${c.ssh!.username}@${c.ssh!.host}`, password: true, ignoreFocusOut: true });
      if (v === undefined) return undefined;
      s.sshPassword = v;
    }
    this.session.set(c.id, s);
    return { ...c, password: s.password, uri: s.uri, apiKey: s.apiKey, ssh: c.ssh ? { ...c.ssh, password: s.sshPassword, passphrase: s.sshPassphrase } : undefined };
  }

  forget(id: string): void {
    const c = this.get(id);
    if (c?.savePassword === false) this.session.delete(id);
  }
}

export class ConnectionManager implements vscode.Disposable {
  private drivers = new Map<string, BaseDriver>();
  private pending = new Map<string, Promise<BaseDriver>>();
  private readonly changed = new vscode.EventEmitter<string>();
  readonly onDidChange = this.changed.event;

  constructor(readonly store: ConnectionStore) {}

  isConnected(id: string): boolean {
    return this.drivers.has(id);
  }

  async get<T extends BaseDriver = BaseDriver>(id: string): Promise<T> {
    const d = this.drivers.get(id);
    if (d) return d as T;
    let p = this.pending.get(id);
    if (!p) {
      p = (async () => {
        const full = await this.store.full(id);
        if (!full) throw new Error('Connection not found');
        const cfg = await this.store.askSecrets(full);
        if (!cfg) throw new Error('Connection cancelled');
        const driver = createDriver(cfg);
        try {
          await driver.connect();
        } catch (e) {
          await driver.close();
          this.store.forget(id);
          throw e;
        }
        this.drivers.set(id, driver);
        this.changed.fire(id);
        return driver;
      })().finally(() => this.pending.delete(id));
      this.pending.set(id, p);
    }
    return (await p) as T;
  }

  async disconnect(id: string): Promise<void> {
    const d = this.drivers.get(id);
    this.drivers.delete(id);
    if (d) {
      await d.close();
      this.changed.fire(id);
    }
  }

  async test(cfg: ConnectionConfig): Promise<string> {
    const driver = createDriver(cfg);
    const t = Date.now();
    try {
      await driver.connect();
      const extra = driver instanceof ElasticDriver && driver.version ? ` · Elasticsearch ${driver.version}` : '';
      return `Connected in ${Date.now() - t} ms${extra}`;
    } finally {
      await driver.close();
    }
  }

  dispose(): void {
    for (const d of this.drivers.values()) void d.close();
    this.drivers.clear();
  }
}
