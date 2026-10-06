import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AiService } from './ai-service';
import { AiPanel } from './panels/ai-panel';
import { ConnectionManager, ConnectionStore } from './connections';
import { DockerDriver } from './drivers/docker';
import { ElasticDriver } from './drivers/elastic';
import { MongoDriver } from './drivers/mongo';
import { RedisDriver } from './drivers/redis';
import { S3Driver } from './drivers/s3';
import { SqlDriver } from './drivers/sql';
import { QueryEditors } from './editor';
import { ConnectionPanel } from './panels/connectionPanel';
import { SchemaPanel } from './panels/schema-panel';
import { DataPanel } from './panels/dataPanel';
import { RedisPanel } from './panels/redisPanel';
import { ResultsView } from './panels/resultsView';
import { openRedisCli } from './redisCli';
import { ConnectionTree } from './tree';
import { searchObjects } from './object-search';
import { ConnectionConfig, DbNode } from './types';
import { errorMessage, formatBytes, uid } from './util';

export function activate(ctx: vscode.ExtensionContext): void {
  const store = new ConnectionStore(ctx);
  const manager = new ConnectionManager(store);
  const tree = new ConnectionTree(manager, ctx.extensionUri);
  const view = vscode.window.createTreeView('dbdeck.connections', { treeDataProvider: tree, showCollapseAll: true });
  const results = new ResultsView(ctx.extensionUri);
  const editors = new QueryEditors(ctx, manager, results);
  const ai = new AiService(ctx);

  const refreshParent = (n?: DbNode) => tree.refresh(n ? tree.getParent(n) : undefined);

  const guard =
    <A extends unknown[]>(fn: (...a: A) => unknown) =>
    async (...a: A) => {
      try {
        await fn(...a);
      } catch (e) {
        void vscode.window.showErrorMessage(errorMessage(e));
      }
    };

  const cmd = (id: string, fn: (...a: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, guard(fn)));

  const confirm = async (message: string, action: string) => (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action;

  const pickNode = async (n?: DbNode) => n ?? view.selection[0];

  ctx.subscriptions.push(manager, view, editors, vscode.window.registerWebviewViewProvider(ResultsView.id, results, { webviewOptions: { retainContextWhenHidden: true } }));

  const openForm = (existing?: Partial<ConnectionConfig>) => ConnectionPanel.show(ctx.extensionUri, manager, () => tree.refresh(), existing);

  cmd('dbdeck.addConnection', () => openForm());
  cmd('dbdeck.searchObjects', async () => {
    const supported = store.list().filter((c) => ['mysql', 'postgres', 'clickhouse', 'mongodb', 'elasticsearch'].includes(c.type));
    let config = supported.find((c) => c.id === view.selection[0]?.connId);
    if (!config) {
      const choice = await vscode.window.showQuickPick(
        supported.map((c) => ({ label: c.name, description: c.type, config: c })),
        { placeHolder: 'Choose a connection to search' },
      );
      config = choice?.config;
    }
    if (!config) return;
    const roots = await tree.getChildren();
    let root = roots.find((n) => n.connId === config!.id);
    if (!root && config.group) {
      const group = roots.find((n) => n.kind === 'group' && n.label === config!.group);
      if (group) root = (await tree.getChildren(group)).find((n) => n.connId === config!.id);
    }
    if (!root) return;
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { node?: DbNode }>();
    picker.title = `Search objects · ${config.name}`;
    picker.placeholder = 'Search tables, schemas, databases, views and functions…';
    picker.matchOnDescription = true;
    picker.matchOnDetail = true;
    picker.busy = true;
    let cancelled = false;
    const items: (vscode.QuickPickItem & { node?: DbNode })[] = [];
    const hidden = picker.onDidHide(() => {
      cancelled = true;
    });
    const accepted = picker.onDidAccept(() => {
      const node = picker.selectedItems[0]?.node;
      if (!node) return;
      picker.hide();
      void Promise.resolve(view.reveal(node, { select: true, focus: true })).catch((e) => vscode.window.showErrorMessage(errorMessage(e)));
    });
    picker.show();
    try {
      for await (const node of searchObjects(
        root,
        (n) => tree.getChildren(n),
        () => cancelled,
      )) {
        items.push({
          label: node.label,
          description: node.kind,
          detail: [node.database, node.schema, node.description].filter(Boolean).join(' · '),
          node: node.kind === 'error' ? undefined : node,
        });
        picker.items = [...items];
      }
      if (!cancelled) {
        picker.busy = false;
        picker.placeholder = items.length ? 'Search tables, schemas, databases, views and functions…' : 'No objects found';
        await new Promise<void>((resolve) => {
          const subscription = picker.onDidHide(() => {
            subscription.dispose();
            resolve();
          });
        });
      }
    } finally {
      hidden.dispose();
      accepted.dispose();
      picker.dispose();
    }
  });
  cmd('dbdeck.editConnection', (n: DbNode) => openForm({ id: n.connId }));
  cmd('dbdeck.duplicateConnection', async (n: DbNode) => {
    const full = await store.full(n.connId);
    if (!full) return;
    await store.save({ ...full, id: uid(), name: `${full.name} copy` });
    tree.refresh();
  });
  cmd('dbdeck.deleteConnection', async (n: DbNode) => {
    if (!(await confirm(`Delete connection "${n.label}"?`, 'Delete'))) return;
    await manager.disconnect(n.connId);
    await store.remove(n.connId);
    tree.refresh();
  });
  cmd('dbdeck.disconnect', async (n: DbNode) => {
    await manager.disconnect(n.connId);
    tree.refresh();
  });
  cmd('dbdeck.refresh', async (n?: DbNode) => {
    if (n?.kind === 'redisDb' || n?.kind === 'redisFolder') (await manager.get<RedisDriver>(n.connId)).invalidate(Number(n.database));
    tree.refresh(n);
  });

  cmd('dbdeck.aiQuery', (node?: DbNode) => AiPanel.show(ctx, manager, editors, ai, node && typeof node.connId === 'string' ? node : undefined));
  cmd('dbdeck.aiConfigure', () => ai.configure());
  cmd('dbdeck.aiSignIn', () => ai.signIn());
  cmd('dbdeck.aiDisconnect', () => ai.disconnect());

  cmd('dbdeck.newQuery', async (n?: DbNode) => {
    n = await pickNode(n);
    if (n) return editors.newQuery(n);
    const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: '' });
    await vscode.window.showTextDocument(doc);
    await editors.selectConnection(doc);
  });
  cmd('dbdeck.openTable', async (n: DbNode) => {
    n = (await pickNode(n))!;
    await DataPanel.show(ctx.extensionUri, manager, n, () => refreshParent(n));
  });
  cmd('dbdeck.showSchema', async (n?: DbNode) => {
    const node = await pickNode(n);
    if (!node) throw new Error('Select a SQL database or schema in Connections.');
    await SchemaPanel.show(ctx.extensionUri, manager, node);
  });
  cmd('dbdeck.selectTop', async (n: DbNode) => {
    const d = await manager.get<SqlDriver>(n.connId);
    const cols = await d.columns({ database: n.database, schema: n.schema, table: n.table! });
    const list = cols.length ? cols.map((c) => d.quote(c.name)).join(', ') : '*';
    await editors.newQuery(n, `SELECT ${list}\nFROM ${d.qualified({ database: n.database, schema: n.schema, table: n.table! })}\nLIMIT 100;\n`);
  });
  cmd('dbdeck.showDdl', async (n: DbNode) => {
    const d = await manager.get<SqlDriver>(n.connId);
    const ref =
      n.kind === 'routine'
        ? { database: n.database, schema: d.dialect === 'mysql' ? n.ref : n.schema, table: d.dialect === 'postgres' ? n.ref! : n.table! }
        : { database: n.database, schema: n.schema, table: n.table! };
    const ddl = await d.ddl(ref, n.kind);
    await editors.newQuery(n, ddl + '\n');
  });
  cmd('dbdeck.copyName', async (n: DbNode) => {
    await vscode.env.clipboard.writeText(n.key ?? n.table ?? n.label);
    vscode.window.setStatusBarMessage(`Copied ${n.key ?? n.table ?? n.label}`, 2000);
  });
  cmd('dbdeck.truncateTable', async (n: DbNode) => {
    const d = await manager.get<SqlDriver>(n.connId);
    if (d.config.readonly) throw new Error('This connection is read-only');
    if (!(await confirm(`Truncate table ${n.table}? All rows will be deleted.`, 'Truncate'))) return;
    await d.run(`TRUNCATE TABLE ${d.qualified({ database: n.database, schema: n.schema, table: n.table! })}`, n.database);
    refreshParent(n);
    vscode.window.setStatusBarMessage(`Truncated ${n.table}`, 3000);
  });
  cmd('dbdeck.dropObject', async (n: DbNode) => {
    const d = await manager.get(n.connId);
    if (d.config.readonly) throw new Error('This connection is read-only');
    const what = n.kind === 'database' ? `database ${n.database}` : `${n.kind} ${n.table}`;
    if (!(await confirm(`Drop ${what}? This cannot be undone.`, 'Drop'))) return;
    if (d instanceof SqlDriver) {
      const sql =
        n.kind === 'database'
          ? `DROP DATABASE ${d.quote(n.database!)}`
          : `DROP ${n.kind === 'view' ? 'VIEW' : 'TABLE'} ${d.qualified({ database: n.database, schema: n.schema, table: n.table! })}`;
      await d.run(sql, n.kind === 'database' ? undefined : n.database);
    } else if (d instanceof MongoDriver) {
      if (n.kind === 'database') await d.db(n.database!).dropDatabase();
      else await d.db(n.database!).collection(n.table!).drop();
    }
    refreshParent(n);
  });

  cmd('dbdeck.runQuery', (arg?: { uri: string; offset: number }) => editors.run(false, arg?.uri ? arg : undefined));
  cmd('dbdeck.runAll', () => editors.run(true));
  cmd('dbdeck.selectConnection', () => editors.selectConnection());

  cmd('dbdeck.exportConnections', async () => {
    const withSecrets = await vscode.window.showQuickPick(['Without passwords', 'Include passwords (plain text)'], { placeHolder: 'Export connections' });
    if (!withSecrets) return;
    const list = await Promise.all(store.list().map((c) => (withSecrets.startsWith('Include') ? store.full(c.id) : c)));
    const uri = await vscode.window.showSaveDialog({ filters: { JSON: ['json'] }, saveLabel: 'Export' });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(list, null, 2)));
    void vscode.window.showInformationMessage(`Exported ${list.length} connection(s).`);
  });
  cmd('dbdeck.importConnections', async () => {
    const [uri] = (await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false })) ?? [];
    if (!uri) return;
    const list = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')) as ConnectionConfig[];
    const existing = new Set(store.list().map((c) => c.id));
    for (const c of list) await store.save({ ...c, id: existing.has(c.id) ? uid() : c.id || uid() });
    tree.refresh();
    void vscode.window.showInformationMessage(`Imported ${list.length} connection(s).`);
  });

  cmd('dbdeck.redis.openKey', (n: DbNode) => RedisPanel.show(ctx.extensionUri, manager, n.connId, Number(n.database), n.key!, () => refreshParent(n)));
  cmd('dbdeck.redis.cli', async (n: DbNode) => {
    const d = await manager.get<RedisDriver>(n.connId);
    openRedisCli(d, store.get(n.connId)!.name, Number(n.database ?? d.config.database ?? 0));
  });
  cmd('dbdeck.redis.filter', async (n: DbNode) => {
    const d = await manager.get<RedisDriver>(n.connId);
    const db = Number(n.database);
    const pattern = await vscode.window.showInputBox({
      prompt: 'Key pattern (SCAN MATCH syntax). Leave empty to show all keys.',
      value: d.filters.get(db) ?? '',
      placeHolder: 'user:*',
    });
    if (pattern === undefined) return;
    if (pattern.trim() && pattern.trim() !== '*') d.filters.set(db, pattern.includes('*') || pattern.includes('?') ? pattern.trim() : `*${pattern.trim()}*`);
    else d.filters.delete(db);
    d.invalidate(db);
    tree.refresh(tree.getParent(n));
  });
  cmd('dbdeck.redis.newKey', async (n: DbNode) => {
    const d = await manager.get<RedisDriver>(n.connId);
    const db = Number(n.database);
    const type = await vscode.window.showQuickPick(['string', 'hash', 'list', 'set', 'zset', 'stream'], { placeHolder: 'Key type' });
    if (!type) return;
    const key = await vscode.window.showInputBox({ prompt: 'Key name', validateInput: (v) => (v.trim() ? undefined : 'Required') });
    if (!key) return;
    const args: Record<string, string[]> = {
      string: ['SET', key, ''],
      hash: ['HSET', key, 'field', 'value'],
      list: ['RPUSH', key, 'item'],
      set: ['SADD', key, 'member'],
      zset: ['ZADD', key, '0', 'member'],
      stream: ['XADD', key, '*', 'field', 'value'],
    };
    await d.exec(db, args[type]);
    d.invalidate(db);
    tree.refresh(n);
    await RedisPanel.show(ctx.extensionUri, manager, n.connId, db, key, () => tree.refresh(n));
  });
  cmd('dbdeck.redis.deleteKey', async (n: DbNode) => {
    const d = await manager.get<RedisDriver>(n.connId);
    const db = Number(n.database);
    if (n.kind === 'redisFolder') {
      if (!(await confirm(`Delete all keys matching "${n.prefix}*"?`, 'Delete'))) return;
      const c = await d.client(db);
      let cursor = '0';
      let total = 0;
      do {
        const [next, keys] = await c.scan(cursor, 'MATCH', `${n.prefix}*`, 'COUNT', 1000);
        cursor = next;
        if (keys.length) total += Number(await d.exec(db, ['UNLINK', ...keys]));
      } while (cursor !== '0');
      vscode.window.setStatusBarMessage(`Deleted ${total} keys`, 3000);
    } else {
      if (!(await confirm(`Delete key "${n.key}"?`, 'Delete'))) return;
      await d.exec(db, ['DEL', n.key!]);
    }
    d.invalidate(db);
    refreshParent(n);
  });
  cmd('dbdeck.redis.flushDb', async (n: DbNode) => {
    if (!(await confirm(`Flush ${n.label}? Every key in this database will be deleted.`, 'Flush'))) return;
    const d = await manager.get<RedisDriver>(n.connId);
    await d.exec(Number(n.database), ['FLUSHDB']);
    d.invalidate(Number(n.database));
    refreshParent(n);
  });

  cmd('dbdeck.es.deleteIndex', async (n: DbNode) => {
    if (!(await confirm(`Delete index "${n.table}"? This cannot be undone.`, 'Delete'))) return;
    const d = await manager.get<ElasticDriver>(n.connId);
    const r = await d.request('DELETE', `/${encodeURIComponent(n.table!)}`);
    if (r.status >= 400) throw new Error(JSON.stringify(r.body));
    refreshParent(n);
  });

  const s3Uri = (n: DbNode) => `s3://${n.database}/${n.key ?? n.prefix ?? ''}`;
  const s3Progress = <T>(title: string, task: () => Promise<T>) => vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, task);
  cmd('dbdeck.s3.open', async (n: DbNode) => {
    const d = await manager.get<S3Driver>(n.connId);
    const size = Number(n.extra?.size ?? 0);
    if (size > 50 * 1024 * 1024 && !(await confirm(`${n.label} is ${formatBytes(size)}. Download and open it?`, 'Open'))) return;
    const safeKey = n
      .key!.split('/')
      .filter((s) => s && s !== '.' && s !== '..')
      .join(path.sep);
    const file = path.join(os.tmpdir(), 'dbdeck-s3', n.connId, n.database!, safeKey || 'object');
    await s3Progress(`Downloading ${n.label}`, () => d.download(n.database!, n.key!, file));
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
  });
  cmd('dbdeck.s3.download', async (n: DbNode) => {
    const d = await manager.get<S3Driver>(n.connId);
    const dir = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir());
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(dir, path.posix.basename(n.key!)), saveLabel: 'Download' });
    if (!uri) return;
    await s3Progress(`Downloading ${n.label}`, () => d.download(n.database!, n.key!, uri.fsPath));
    vscode.window.setStatusBarMessage(`Downloaded ${s3Uri(n)}`, 3000);
  });
  cmd('dbdeck.s3.upload', async (n: DbNode) => {
    const d = await manager.get<S3Driver>(n.connId);
    if (d.config.readonly) throw new Error('This connection is read-only');
    const files = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Upload' });
    if (!files?.length) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Uploading to ${s3Uri(n)}` }, async (p) => {
      for (const [i, f] of files.entries()) {
        p.report({ message: `${i + 1}/${files.length} ${path.basename(f.fsPath)}` });
        await d.upload(n.database!, (n.prefix ?? '') + path.basename(f.fsPath), f.fsPath);
      }
    });
    tree.refresh(n);
  });
  cmd('dbdeck.s3.copyUri', async (n: DbNode) => {
    await vscode.env.clipboard.writeText(s3Uri(n));
    vscode.window.setStatusBarMessage(`Copied ${s3Uri(n)}`, 2000);
  });
  cmd('dbdeck.s3.delete', async (n: DbNode) => {
    const d = await manager.get<S3Driver>(n.connId);
    if (d.config.readonly) throw new Error('This connection is read-only');
    if (n.kind === 's3Prefix') {
      if (!(await confirm(`Delete every object under ${s3Uri(n)}?`, 'Delete'))) return;
      const total = await s3Progress(`Deleting ${s3Uri(n)}`, () => d.removePrefix(n.database!, n.prefix!));
      vscode.window.setStatusBarMessage(`Deleted ${total} objects`, 3000);
    } else {
      if (!(await confirm(`Delete ${s3Uri(n)}?`, 'Delete'))) return;
      await d.remove(n.database!, n.key!);
    }
    refreshParent(n);
  });

  const dockerAction = (action: string) => async (n: DbNode) => {
    const d = await manager.get<DockerDriver>(n.connId);
    if (action === 'remove' && !(await confirm(`Remove ${n.kind} "${n.label}"?`, 'Remove'))) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `${action} ${n.label}` }, () => d.action(n.kind, n.ref!, action));
    tree.refresh();
  };
  cmd('dbdeck.docker.start', dockerAction('start'));
  cmd('dbdeck.docker.stop', dockerAction('stop'));
  cmd('dbdeck.docker.restart', dockerAction('restart'));
  cmd('dbdeck.docker.remove', dockerAction('remove'));
  const dockerTerminal = async (n: DbNode, title: string, args: string[]) => {
    const d = await manager.get<DockerDriver>(n.connId);
    const t = vscode.window.createTerminal({ name: title, shellPath: 'docker', shellArgs: args, env: { DOCKER_HOST: d.dockerHost }, iconPath: new vscode.ThemeIcon('vm') });
    t.show();
  };
  cmd('dbdeck.docker.logs', (n: DbNode) => dockerTerminal(n, `logs: ${n.label}`, ['logs', '-f', '--tail', '500', n.ref!]));
  cmd('dbdeck.docker.shell', (n: DbNode) => dockerTerminal(n, `sh: ${n.label}`, ['exec', '-it', n.ref!, 'sh', '-c', 'command -v bash >/dev/null && exec bash || exec sh']));
  cmd('dbdeck.docker.inspect', async (n: DbNode) => {
    const d = await manager.get<DockerDriver>(n.connId);
    const info = await d.inspect(n.kind, n.ref!);
    const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(info, null, 2) });
    await vscode.window.showTextDocument(doc, { preview: true });
  });
  cmd('dbdeck.docker.addConnection', async (n: DbNode) => {
    const d = await manager.get<DockerDriver>(n.connId);
    const pre = await d.connectionFor(n.ref!);
    if (!pre) {
      void vscode.window.showInformationMessage(`"${n.label}" does not look like a supported database container.`);
      return;
    }
    await openForm({ ...pre, group: 'Docker' });
  });
}

export function deactivate(): void {
  return undefined;
}
