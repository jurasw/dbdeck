import * as fs from 'fs';
import * as net from 'net';
import { Client } from 'ssh2';
import { ConnectionConfig, DbNode, NodeKind, SshConfig } from '../types';
import { expandHome } from '../util';

export interface Tunnel {
  host: string;
  port: number;
  close(): void;
}

export async function openTunnel(ssh: SshConfig, dstHost: string, dstPort: number): Promise<Tunnel> {
  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    client
      .once('ready', () => resolve())
      .once('error', reject)
      .connect({
        host: ssh.host,
        port: ssh.port || 22,
        username: ssh.username,
        password: ssh.authType === 'password' ? ssh.password : undefined,
        privateKey: ssh.authType === 'key' && ssh.privateKeyPath ? fs.readFileSync(expandHome(ssh.privateKeyPath)) : undefined,
        passphrase: ssh.passphrase || undefined,
        readyTimeout: 15000,
        keepaliveInterval: 15000,
      });
  });
  const server = net.createServer((sock) => {
    client.forwardOut('127.0.0.1', sock.remotePort ?? 0, dstHost, dstPort, (err, stream) => {
      if (err) {
        sock.destroy();
        return;
      }
      sock.pipe(stream).pipe(sock);
      stream.on('error', () => sock.destroy());
      sock.on('error', () => stream.end());
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as net.AddressInfo).port;
  client.on('close', () => server.close());
  return {
    host: '127.0.0.1',
    port,
    close() {
      server.close();
      client.end();
    },
  };
}

export abstract class BaseDriver {
  private tunnel?: Tunnel;

  constructor(public readonly config: ConnectionConfig) {}

  protected async endpoint(defaultPort: number): Promise<{ host: string; port: number }> {
    const host = this.config.host || '127.0.0.1';
    const port = this.config.port || defaultPort;
    if (!this.config.ssh?.enabled) return { host, port };
    this.tunnel ??= await openTunnel(this.config.ssh, host, port);
    return { host: this.tunnel.host, port: this.tunnel.port };
  }

  protected node(kind: NodeKind, label: string, props: Partial<DbNode> = {}): DbNode {
    return { connId: this.config.id, kind, label, ...props };
  }

  abstract connect(): Promise<void>;
  protected abstract disconnect(): Promise<void>;
  abstract children(node?: DbNode): Promise<DbNode[]>;

  async close(): Promise<void> {
    await this.disconnect().catch(() => undefined);
    this.tunnel?.close();
    this.tunnel = undefined;
  }
}
