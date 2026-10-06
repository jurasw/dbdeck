import * as vscode from 'vscode';
import { AiService } from '../ai-service';
import { ConnectionManager } from '../connections';
import { SqlDriver } from '../drivers/sql';
import { QueryEditors } from '../editor';
import { DbNode } from '../types';
import { bindRpc, webviewHtml, webviewOptions } from '../webviewHost';

export class AiPanel {
  static async show(ctx: vscode.ExtensionContext, manager: ConnectionManager, editors: QueryEditors, ai: AiService, node?: DbNode): Promise<void> {
    if (!node) {
      const editor = vscode.window.activeTextEditor;
      const binding = editor && editors.binding(editor.document);
      if (binding) node = { ...binding, kind: 'database', label: binding.database ?? 'Database' };
    }
    if (!node) {
      const selected = await vscode.window.showQuickPick(
        manager.store
          .list()
          .filter((c) => ['postgres', 'mysql', 'clickhouse'].includes(c.type))
          .map((config) => ({ label: config.name, description: config.type, config })),
        { title: 'AI query · SQL connection' },
      );
      if (!selected) return;
      node = { connId: selected.config.id, kind: 'connection', label: selected.config.name, database: selected.config.database };
    }
    const driver = await manager.get(node.connId);
    if (!(driver instanceof SqlDriver)) throw new Error('AI query generation currently supports PostgreSQL, MySQL and ClickHouse.');
    const database = node.database ?? (await vscode.window.showQuickPick(await driver.databases(), { title: 'AI query · database' }));
    if (!database) return;
    const target: DbNode = { ...node, database };
    const objects = await driver.objects(database, node.schema, null);
    const panel = vscode.window.createWebviewPanel('dbdeck.ai', 'AI Query · DBDeck', vscode.ViewColumn.Active, webviewOptions(ctx.extensionUri));
    panel.iconPath = new vscode.ThemeIcon('sparkle');
    let request: AbortController | undefined;
    let generated: string | undefined;
    let disposed = false;
    const subscriptions = bindRpc(panel.webview, {
      status: () => ai.status(),
      configure: async () => {
        if (request) throw new Error('Cancel generation before changing providers.');
        await ai.configure();
        return ai.status();
      },
      signIn: async () => {
        if (request) throw new Error('Cancel generation before signing in.');
        await ai.signIn();
        return ai.status();
      },
      model: async () => {
        if (request) throw new Error('Cancel generation before changing models.');
        await ai.chooseModel();
        return ai.status();
      },
      disconnect: async () => {
        request?.abort();
        await ai.disconnect();
        return ai.status();
      },
      usage: () => vscode.env.openExternal(vscode.Uri.parse('https://chatgpt.com/settings/usage')),
      cancel: () => request?.abort(),
      generate: async (params: { prompt: string; tables: number[] }) => {
        if (request) throw new Error('A query is already being generated.');
        if (
          typeof params.prompt !== 'string' ||
          !Array.isArray(params.tables) ||
          !params.tables.length ||
          params.tables.length > 50 ||
          params.tables.some((i) => !Number.isInteger(i) || !objects[i])
        )
          throw new Error('Choose 1–50 tables for the schema context.');
        request = new AbortController();
        generated = undefined;
        try {
          const tables = [];
          for (const index of new Set(params.tables)) {
            request.signal.throwIfAborted();
            const object = objects[index];
            const columns = await driver.columns({ database, schema: object.schema, table: object.name });
            tables.push({ schema: object.schema, table: object.name, columns: columns.map((c) => ({ name: c.name, type: c.type, primaryKey: c.pk, nullable: c.nullable })) });
          }
          request.signal.throwIfAborted();
          const query = await ai.generate(params.prompt, JSON.stringify(tables), driver.dialect, request.signal);
          if (disposed || request.signal.aborted) throw new Error('Generation cancelled.');
          generated = query;
          return query;
        } finally {
          request = undefined;
        }
      },
      insert: async () => {
        if (!generated || request || disposed) throw new Error('Generate and review a query first.');
        await editors.newQuery(target, `${generated}\n`);
      },
    });
    panel.onDidDispose(() => {
      disposed = true;
      request?.abort();
      subscriptions.dispose();
    });
    panel.webview.html = webviewHtml(panel.webview, ctx.extensionUri, 'ai', 'AI Query · DBDeck', {
      connection: manager.store.get(node.connId)?.name,
      database,
      dialect: driver.dialect,
      objects: objects.map((o, index) => ({ index, label: [o.schema, o.name].filter(Boolean).join('.'), selected: o.name === node?.table && o.schema === node?.schema })),
    });
  }
}
