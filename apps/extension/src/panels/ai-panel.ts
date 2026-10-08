import * as vscode from 'vscode';
import { AiService } from '../ai-service';
import { ConnectionManager } from '../connections';
import { AiDatabase, aiDatabase } from '../ai-database';
import { ElasticDriver } from '../drivers/elastic';
import { MongoDriver } from '../drivers/mongo';
import { SqlDriver } from '../drivers/sql';
import { QueryEditors } from '../editor';
import { DbNode, FAMILY } from '../types';
import { bindRpc, webviewHtml, webviewOptions } from '../webviewHost';

const AI_FAMILIES = new Set(['sql', 'mongo', 'es']);

export const LANGUAGE_LABEL = { sql: 'SQL', mongo: 'MongoDB', es: 'Elasticsearch' } as const;
export const OBJECTS_LABEL = { sql: 'tables', mongo: 'collections', es: 'indices' } as const;

export async function aiContext(
  manager: ConnectionManager,
  editors: QueryEditors,
  node: DbNode | undefined,
  title: string,
): Promise<{ node: DbNode; db: AiDatabase; database?: string } | undefined> {
  if (!node) {
    const editor = vscode.window.activeTextEditor;
    const binding = editor && editors.binding(editor.document);
    if (binding) node = { ...binding, kind: 'database', label: binding.database ?? 'Database' };
  }
  if (!node) {
    const selected = await vscode.window.showQuickPick(
      manager.store
        .list()
        .filter((c) => AI_FAMILIES.has(FAMILY[c.type]))
        .map((config) => ({ label: config.name, description: config.type, config })),
      { title: `${title} · connection` },
    );
    if (!selected) return undefined;
    node = { connId: selected.config.id, kind: 'connection', label: selected.config.name, database: selected.config.database };
  }
  const driver = await manager.get(node.connId);
  if (driver instanceof ElasticDriver) return { node, db: aiDatabase(driver, undefined)! };
  if (!(driver instanceof SqlDriver || driver instanceof MongoDriver)) throw new Error(`${title} supports SQL, MongoDB and Elasticsearch connections.`);
  const database = node.database ?? (await vscode.window.showQuickPick(await driver.databases(), { title: `${title} · database` }));
  if (!database) return undefined;
  return { node, db: aiDatabase(driver, database)!, database };
}

export class AiPanel {
  static async show(
    ctx: Pick<vscode.ExtensionContext, 'extensionUri'>,
    manager: ConnectionManager,
    editors: QueryEditors,
    ai: AiService,
    node?: DbNode,
    back?: () => void,
  ): Promise<void> {
    const context = await aiContext(manager, editors, node, 'AI query');
    if (!context) return;
    const { db, database } = context;
    node = context.node;
    const target: DbNode = { ...node, database };
    const origin = node;
    const rank = (o: { name: string; schema?: string }) => (o.name === origin.table && o.schema === origin.schema ? 0 : o.schema === origin.schema ? 1 : 2);
    const objects = (await db.objects(origin.table ? undefined : origin.schema)).sort((a, b) => rank(a) - rank(b));
    const panel = vscode.window.createWebviewPanel('dbdeck.ai', 'AI Query · DBDeck', vscode.ViewColumn.Active, webviewOptions(ctx.extensionUri));
    panel.iconPath = new vscode.ThemeIcon('sparkle');
    let request: AbortController | undefined;
    let generated: string | undefined;
    let disposed = false;
    const subscriptions = bindRpc(panel.webview, {
      back: () => {
        back?.();
        panel.dispose();
      },
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
      mcp: () => vscode.commands.executeCommand('dbdeck.mcpSetup'),
      chat: () => vscode.commands.executeCommand('dbdeck.aiChat', target),
      cancel: () => request?.abort(),
      generate: async (params: { prompt: string }) => {
        if (request) throw new Error('A query is already being generated.');
        if (typeof params.prompt !== 'string' || !objects.length) throw new Error(`The current database context has no available ${OBJECTS_LABEL[db.family]}.`);
        request = new AbortController();
        generated = undefined;
        try {
          const tables = [];
          let schemaSize = 0;
          for (const index of objects.keys()) {
            request.signal.throwIfAborted();
            const object = objects[index];
            const columns = await db.fields({ schema: object.schema, table: object.name });
            const table = { schema: object.schema, table: object.name, columns };
            const size = JSON.stringify(table).length + 1;
            if (schemaSize + size > 99000) continue;
            schemaSize += size;
            tables.push(table);
          }
          request.signal.throwIfAborted();
          const query = await ai.generate(params.prompt, JSON.stringify(tables), db.dialect, request.signal);
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
      settings: !!back,
      connection: manager.store.get(node.connId)?.name,
      database,
      dialect: db.dialect,
      language: LANGUAGE_LABEL[db.family],
      noun: OBJECTS_LABEL[db.family],
      objects: objects.map((o, index) => ({ index, label: [o.schema, o.name].filter(Boolean).join('.'), selected: o.name === node?.table && o.schema === node?.schema })),
    });
  }
}
