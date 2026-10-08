import * as os from 'os';
import * as path from 'path';
import { ConnectionConfig, DbNode, DbType } from '../types';
import { fileExists, formatBytes, httpRequest } from '../util';
import { BaseDriver } from './base';

interface ContainerInfo {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Ports: { PrivatePort: number; PublicPort?: number; IP?: string; Type: string }[];
  Labels: Record<string, string>;
}

const STATE_ICON: Record<string, [string, string]> = {
  running: ['vm-running', 'charts.green'],
  paused: ['debug-pause', 'charts.yellow'],
  restarting: ['sync', 'charts.yellow'],
  exited: ['vm-outline', 'disabledForeground'],
  dead: ['error', 'charts.red'],
  created: ['vm-outline', 'disabledForeground'],
};

export function defaultSocket(): string {
  if (process.platform === 'win32') return '//./pipe/docker_engine';
  const candidates = [
    '/var/run/docker.sock',
    path.join(os.homedir(), '.docker/run/docker.sock'),
    path.join(os.homedir(), '.orbstack/run/docker.sock'),
    path.join(os.homedir(), '.colima/default/docker.sock'),
    path.join(os.homedir(), '.rd/docker.sock'),
  ];
  return candidates.find(fileExists) ?? candidates[0];
}

export class DockerDriver extends BaseDriver {
  private socket?: string;
  private base?: string;

  async connect(): Promise<void> {
    if (this.config.useSocket !== false) this.socket = this.config.socketPath || defaultSocket();
    else {
      const { host, port } = await this.endpoint(2375);
      this.base = `${this.config.ssl ? 'https' : 'http'}://${host}:${port}`;
    }
    const r = await this.api('GET', '/_ping');
    if (r !== 'OK') throw new Error(`Unexpected ping response: ${String(r)}`);
  }

  protected async disconnect(): Promise<void> {
    this.socket = this.base = undefined;
  }

  get dockerHost(): string {
    return this.socket ? (process.platform === 'win32' ? `npipe://${this.socket}` : `unix://${this.socket}`) : (this.base ?? '').replace(/^http/, 'tcp');
  }

  async api<T = unknown>(method: string, p: string, body?: unknown): Promise<T> {
    const r = await httpRequest({
      method,
      socketPath: this.socket,
      path: p,
      url: this.base ? this.base + p : undefined,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      rejectUnauthorized: this.config.rejectUnauthorized ?? false,
    });
    let parsed: unknown = r.body;
    try {
      parsed = r.body ? JSON.parse(r.body) : r.body;
    } catch {
      parsed = r.body;
    }
    if (r.status >= 400) throw new Error((parsed as { message?: string })?.message ?? `HTTP ${r.status}`);
    return parsed as T;
  }

  async children(n?: DbNode): Promise<DbNode[]> {
    if (!n) {
      const [containers, images, volumes, networks] = await Promise.all([
        this.api<ContainerInfo[]>('GET', '/containers/json?all=1'),
        this.api<unknown[]>('GET', '/images/json'),
        this.api<{ Volumes: unknown[] | null }>('GET', '/volumes'),
        this.api<unknown[]>('GET', '/networks'),
      ]);
      const running = containers.filter((c) => c.State === 'running').length;
      return [
        this.node('dockerFolder', 'Containers', {
          ref: 'containers',
          icon: 'layers',
          description: `${running}/${containers.length} running`,
          tags: 'dockerFolder',
          expanded: true,
        }),
        this.node('dockerFolder', 'Images', { ref: 'images', icon: 'file-binary', description: String(images.length), tags: 'dockerFolder' }),
        this.node('dockerFolder', 'Volumes', { ref: 'volumes', icon: 'archive', description: String(volumes.Volumes?.length ?? 0), tags: 'dockerFolder' }),
        this.node('dockerFolder', 'Networks', { ref: 'networks', icon: 'type-hierarchy', description: String(networks.length), tags: 'dockerFolder' }),
      ];
    }
    if (n.kind === 'dockerFolder' && n.ref === 'containers') {
      const list = await this.api<ContainerInfo[]>('GET', '/containers/json?all=1');
      const projects = new Map<string, ContainerInfo[]>();
      const loose: ContainerInfo[] = [];
      for (const c of list) {
        const p = c.Labels?.['com.docker.compose.project'];
        if (p) projects.set(p, [...(projects.get(p) ?? []), c]);
        else loose.push(c);
      }
      const out: DbNode[] = [...projects]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([p, cs]) =>
          this.node('dockerFolder', p, {
            ref: `project:${p}`,
            icon: 'library',
            description: `${cs.filter((c) => c.State === 'running').length}/${cs.length} running`,
            tags: 'dockerFolder',
            expanded: true,
          }),
        );
      return out.concat(loose.sort(byName).map((c) => this.containerNode(c)));
    }
    if (n.kind === 'dockerFolder' && n.ref?.startsWith('project:')) {
      const project = n.ref.slice(8);
      const list = await this.api<ContainerInfo[]>(
        'GET',
        `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${project}`] }))}`,
      );
      return list.sort(byName).map((c) => this.containerNode(c, true));
    }
    if (n.kind === 'dockerFolder' && n.ref === 'images') {
      const list = await this.api<{ Id: string; RepoTags: string[] | null; Size: number; Created: number }[]>('GET', '/images/json');
      return list
        .map((i) => ({ i, tag: i.RepoTags?.find((t) => t !== '<none>:<none>') ?? i.Id.slice(7, 19) }))
        .sort((a, b) => a.tag.localeCompare(b.tag))
        .map(({ i, tag }) =>
          this.node('image', tag, {
            ref: i.Id,
            description: `${formatBytes(i.Size)} · ${new Date(i.Created * 1000).toLocaleDateString()}`,
            icon: 'file-binary',
            leaf: true,
            tags: 'image',
          }),
        );
    }
    if (n.kind === 'dockerFolder' && n.ref === 'volumes') {
      const r = await this.api<{ Volumes: { Name: string; Driver: string; Labels: Record<string, string> | null }[] | null }>('GET', '/volumes');
      return (r.Volumes ?? [])
        .sort((a, b) => a.Name.localeCompare(b.Name))
        .map((v) =>
          this.node('volume', v.Name, {
            ref: v.Name,
            description: v.Labels?.['com.docker.compose.project'] ?? v.Driver,
            icon: 'archive',
            leaf: true,
            tags: 'volume',
          }),
        );
    }
    if (n.kind === 'dockerFolder' && n.ref === 'networks') {
      const r = await this.api<{ Id: string; Name: string; Driver: string }[]>('GET', '/networks');
      return r
        .sort((a, b) => a.Name.localeCompare(b.Name))
        .map((x) => this.node('network', x.Name, { ref: x.Id, description: x.Driver, icon: 'type-hierarchy', leaf: true, tags: 'network' }));
    }
    return [];
  }

  private containerNode(c: ContainerInfo, inProject = false): DbNode {
    const name = (inProject && c.Labels['com.docker.compose.service']) || c.Names[0]?.replace(/^\//, '') || c.Id.slice(0, 12);
    const [icon, color] = STATE_ICON[c.State] ?? ['vm', 'foreground'];
    const ports = [...new Set(c.Ports.filter((p) => p.PublicPort).map((p) => `${p.PublicPort}→${p.PrivatePort}`))];
    return this.node('container', name, {
      ref: c.Id,
      description: `${c.Image}${ports.length ? ` · ${ports.join(', ')}` : ''}`,
      tooltip: `${c.Names[0]?.replace(/^\//, '')}\n${c.Image}\n${c.Status}${ports.length ? `\nPorts: ${ports.join(', ')}` : ''}`,
      icon,
      color,
      leaf: true,
      tags: `container ${c.State === 'running' ? 'running' : 'stopped'}`,
    });
  }

  async action(kind: string, id: string, action: string): Promise<void> {
    if (kind === 'container') {
      if (action === 'remove') await this.api('DELETE', `/containers/${id}?force=true&v=false`);
      else await this.api('POST', `/containers/${id}/${action}`);
    } else if (kind === 'image') await this.api('DELETE', `/images/${encodeURIComponent(id)}?force=true`);
    else if (kind === 'volume') await this.api('DELETE', `/volumes/${encodeURIComponent(id)}`);
  }

  async inspect(kind: string, id: string): Promise<unknown> {
    const id_ = encodeURIComponent(id);
    const p = { container: `/containers/${id_}/json`, image: `/images/${id_}/json`, volume: `/volumes/${id_}`, network: `/networks/${id_}` }[kind];
    if (!p) throw new Error(`Cannot inspect ${kind}`);
    return this.api('GET', p);
  }

  async connectionFor(id: string): Promise<Partial<ConnectionConfig> | undefined> {
    const info = await this.api<{
      Name: string;
      Config: { Image: string; Env: string[] | null };
      NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> };
    }>('GET', `/containers/${id}/json`);
    const env = Object.fromEntries((info.Config.Env ?? []).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
    const image = info.Config.Image.toLowerCase();
    const detect: [RegExp, DbType, number][] = [
      [/cockroach/, 'postgres', 26257],
      [/yugabyte/, 'postgres', 5433],
      [/postgres|postgis|timescale/, 'postgres', 5432],
      [/tidb/, 'mysql', 4000],
      [/mysql|mariadb|percona|singlestore|memsql/, 'mysql', 3306],
      [/mssql\/server|azure-sql-edge/, 'mssql', 1433],
      [/cassandra/, 'cassandra', 9042],
      [/dynamodb-local/, 'dynamodb', 8000],
      [/mongo|ferretdb/, 'mongodb', 27017],
      [/redis|valkey|keydb|dragonfly/, 'redis', 6379],
      [/elasticsearch|opensearch/, 'elasticsearch', 9200],
      [/clickhouse/, 'clickhouse', 8123],
      [/minio|rustfs/, 's3', 9000],
    ];
    const hit = detect.find(([re]) => re.test(image));
    if (!hit) return undefined;
    const [, type, inner] = hit;
    const binding = info.NetworkSettings.Ports?.[`${inner}/tcp`]?.[0];
    const host = !binding?.HostIp || binding.HostIp === '0.0.0.0' || binding.HostIp === '::' ? '127.0.0.1' : binding.HostIp;
    const base: Partial<ConnectionConfig> = { type, name: info.Name.replace(/^\//, ''), host, port: binding ? Number(binding.HostPort) : inner };
    if (/cockroach/.test(image)) return { ...base, user: env.COCKROACH_USER || 'root', password: env.COCKROACH_PASSWORD, database: env.COCKROACH_DATABASE || 'defaultdb' };
    if (/yugabyte/.test(image)) return { ...base, user: env.YSQL_USER || 'yugabyte', password: env.YSQL_PASSWORD, database: env.YSQL_DB || 'yugabyte' };
    if (/tidb/.test(image)) return { ...base, user: 'root' };
    if (/singlestore|memsql/.test(image)) return { ...base, user: 'root', password: env.ROOT_PASSWORD };
    if (/ferretdb/.test(image)) return { ...base, user: env.FERRETDB_USERNAME || env.POSTGRES_USER, password: env.FERRETDB_PASSWORD || env.POSTGRES_PASSWORD };
    if (/opensearch/.test(image))
      return env.DISABLE_SECURITY_PLUGIN === 'true' ? base : { ...base, user: 'admin', password: env.OPENSEARCH_INITIAL_ADMIN_PASSWORD, ssl: true, rejectUnauthorized: false };
    switch (type) {
      case 'postgres':
        return { ...base, user: env.POSTGRES_USER || 'postgres', password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB };
      case 'mssql':
        return { ...base, user: 'sa', password: env.MSSQL_SA_PASSWORD || env.SA_PASSWORD, database: 'master', ssl: true, rejectUnauthorized: false };
      case 'cassandra':
        return { ...base, localDatacenter: env.CASSANDRA_DC || 'datacenter1' };
      case 'dynamodb':
        return {
          ...base,
          endpoint: `http://${base.host}:${base.port}`,
          region: 'us-east-1',
          user: env.AWS_ACCESS_KEY_ID || 'local',
          password: env.AWS_SECRET_ACCESS_KEY || 'local',
        };
      case 'mysql':
        return env.MYSQL_ROOT_PASSWORD || env.MARIADB_ROOT_PASSWORD
          ? { ...base, user: 'root', password: env.MYSQL_ROOT_PASSWORD || env.MARIADB_ROOT_PASSWORD, database: env.MYSQL_DATABASE || env.MARIADB_DATABASE }
          : { ...base, user: env.MYSQL_USER || env.MARIADB_USER || 'root', password: env.MYSQL_PASSWORD || env.MARIADB_PASSWORD, database: env.MYSQL_DATABASE };
      case 'mongodb':
        return { ...base, user: env.MONGO_INITDB_ROOT_USERNAME, password: env.MONGO_INITDB_ROOT_PASSWORD };
      case 'redis':
        return { ...base, password: env.REDIS_PASSWORD };
      case 'elasticsearch':
        return { ...base, user: env.ELASTIC_PASSWORD ? 'elastic' : undefined, password: env.ELASTIC_PASSWORD, ssl: env['xpack.security.http.ssl.enabled'] === 'true' };
      case 'clickhouse':
        return { ...base, user: env.CLICKHOUSE_USER || 'default', password: env.CLICKHOUSE_PASSWORD, database: env.CLICKHOUSE_DB };
      case 's3':
        return {
          ...base,
          endpoint: `http://${base.host}:${base.port}`,
          forcePathStyle: true,
          user: env.MINIO_ROOT_USER || env.RUSTFS_ACCESS_KEY || 'minioadmin',
          password: env.MINIO_ROOT_PASSWORD || env.RUSTFS_SECRET_KEY || 'minioadmin',
        };
    }
    return base;
  }
}

function byName(a: ContainerInfo, b: ContainerInfo): number {
  return (a.Names[0] ?? '').localeCompare(b.Names[0] ?? '');
}
