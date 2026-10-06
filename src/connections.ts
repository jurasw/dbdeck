import * as vscode from 'vscode';
import { BaseDriver } from './drivers/base';
import { ClickHouseDriver } from './drivers/clickhouse';
import { DockerDriver } from './drivers/docker';
import { ElasticDriver } from './drivers/elastic';
import { MongoDriver } from './drivers/mongo';
import { MysqlDriver } from './drivers/mysql';
import { PostgresDriver } from './drivers/postgres';
import { RedisDriver } from './drivers/redis';
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
    case 'clickhouse':
      return new ClickHouseDriver(c);
    case 'mongodb':
      return new MongoDriver(c);
    case 'redis':
      return new RedisDriver(c);
    case 'elasticsearch':
      return new ElasticDriver(c);
    case 'docker':
      return new DockerDriver(c);
  }
}

export class ConnectionStore {
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
    const raw = await this.ctx.secrets.get(`dbdeck.secret.${id}`);
    const s: Secrets = raw ? JSON.parse(raw) : {};
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
    await this.ctx.secrets.store(`dbdeck.secret.${c.id}`, JSON.stringify(s));
    await this.ctx.globalState.update(LIST_KEY, list);
  }

  async remove(id: string): Promise<void> {
    await this.ctx.globalState.update(
      LIST_KEY,
      this.list().filter((c) => c.id !== id),
    );
    await this.ctx.secrets.delete(`dbdeck.secret.${id}`);
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
        const cfg = await this.store.full(id);
        if (!cfg) throw new Error('Connection not found');
        const driver = createDriver(cfg);
        try {
          await driver.connect();
        } catch (e) {
          await driver.close();
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
