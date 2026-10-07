import * as os from 'os';
import * as vscode from 'vscode';
import { ConnectionManager } from './connections';
import { ConnectionConfig, DbNode, FAMILY, TYPE_LABEL } from './types';
import { errorMessage } from './util';

const OPEN_KINDS = new Set(['table', 'view', 'collection', 'esIndex']);

export function nodeId(n: DbNode): string {
  return [n.connId, n.kind, n.database, n.schema, n.table, n.ref, n.prefix, n.key, n.label].map((x) => x ?? '').join('/');
}

export class ConnectionTree implements vscode.TreeDataProvider<DbNode> {
  private readonly emitter = new vscode.EventEmitter<DbNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private parents = new Map<string, DbNode>();

  constructor(
    private readonly manager: ConnectionManager,
    private readonly extUri: vscode.Uri,
  ) {
    manager.onDidChange(() => this.emitter.fire());
  }

  refresh(n?: DbNode): void {
    this.emitter.fire(n);
  }

  getParent(n: DbNode): DbNode | undefined {
    return this.parents.get(nodeId(n));
  }

  private connectionNode(c: ConnectionConfig): DbNode {
    return {
      connId: c.id,
      kind: 'connection',
      label: c.name,
      description: describe(c),
      tooltip: `${TYPE_LABEL[c.type]}\n${describe(c)}${c.ssh?.enabled ? `\nvia SSH ${c.ssh.username}@${c.ssh.host}` : ''}${c.readonly ? '\nread-only' : ''}`,
      tags: `conn ${FAMILY[c.type]} ${c.type}`,
    };
  }

  async getChildren(parent?: DbNode): Promise<DbNode[]> {
    const conns = this.manager.store.list();
    if (!parent) {
      const groups = [...new Set(conns.map((c) => c.group).filter(Boolean) as string[])].sort();
      const out: DbNode[] = groups.map((g) => ({ connId: '', kind: 'group', label: g, icon: 'folder', tags: 'group', expanded: true }));
      return out.concat(conns.filter((c) => !c.group).map((c) => this.connectionNode(c)));
    }
    if (parent.kind === 'group') {
      const kids = conns.filter((c) => c.group === parent.label).map((c) => this.connectionNode(c));
      for (const k of kids) this.parents.set(nodeId(k), parent);
      return kids;
    }
    try {
      const driver = await this.manager.get(parent.connId);
      const kids = await driver.children(parent.kind === 'connection' ? undefined : parent);
      for (const k of kids) this.parents.set(nodeId(k), parent);
      if (!kids.length) return [{ connId: parent.connId, kind: 'info', label: 'empty', icon: 'circle-slash', leaf: true }];
      return kids;
    } catch (e) {
      const msg = errorMessage(e);
      if (parent.kind === 'connection') void vscode.window.showErrorMessage(`${parent.label}: ${msg}`);
      return [{ connId: parent.connId, kind: 'error', label: msg, icon: 'error', color: 'errorForeground', leaf: true, tooltip: msg }];
    }
  }

  getTreeItem(n: DbNode): vscode.TreeItem {
    const state =
      n.kind === 'connection'
        ? this.manager.isConnected(n.connId)
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : n.leaf || n.kind === 'info' || n.kind === 'error'
          ? vscode.TreeItemCollapsibleState.None
          : n.expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
    const item = new vscode.TreeItem(n.label, state);
    item.id = nodeId(n) + (n.kind === 'connection' ? `#${this.manager.isConnected(n.connId) ? 1 : 0}` : '');
    item.description = n.description;
    item.tooltip = n.tooltip;
    if (n.kind === 'connection') {
      const cfg = this.manager.store.get(n.connId);
      const on = this.manager.isConnected(n.connId);
      item.iconPath = vscode.Uri.joinPath(this.extUri, 'media', 'types', `${cfg?.type}${on ? '-on' : ''}.svg`);
      item.contextValue = `${n.tags}${on ? ' on' : ''}`;
    } else {
      item.contextValue = n.tags ?? n.kind;
      if (n.icon) item.iconPath = new vscode.ThemeIcon(n.icon, n.color ? new vscode.ThemeColor(n.color) : undefined);
    }
    if (OPEN_KINDS.has(n.kind)) item.command = { command: 'dbdeck.openTable', title: 'Open', arguments: [n] };
    else if (n.kind === 'redisKey') item.command = { command: 'dbdeck.redis.openKey', title: 'Open', arguments: [n] };
    else if (n.kind === 's3Object') item.command = { command: 'dbdeck.s3.open', title: 'Open', arguments: [n] };
    else if (n.kind === 'routine') item.command = { command: 'dbdeck.showDdl', title: 'Open', arguments: [n] };
    return item;
  }
}

function describe(c: ConnectionConfig): string {
  if (c.type === 'docker') return c.useSocket !== false ? c.socketPath || 'local socket' : `${c.host}:${c.port ?? 2375}`;
  if (c.type === 'mongodb' && c.useUri) return '';
  if (c.type === 'elasticsearch' && c.kibanaUrl) return `via Kibana · ${c.kibanaUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  if (c.type === 'sqlite') return c.database?.replace(os.homedir(), '~') ?? '';
  if (c.type === 'bigquery') return [c.project || 'default project', c.region].filter(Boolean).join(' · ');
  if (c.type === 'snowflake') return [`${c.user ?? ''}@${c.host ?? ''}`, c.warehouse].filter(Boolean).join(' · ');
  if (c.type === 's3' && c.googleAuth) return ['Google Cloud', c.database || c.project, c.googleEmail].filter(Boolean).join(' · ');
  if (c.type === 's3') return [c.endpoint ? c.endpoint.replace(/^https?:\/\//, '') : `AWS ${c.region || 'us-east-1'}`, c.database].filter(Boolean).join(' · ');
  const user = c.user ? `${c.user}@` : '';
  return `${user}${c.host || '127.0.0.1'}${c.port ? `:${c.port}` : ''}`;
}
