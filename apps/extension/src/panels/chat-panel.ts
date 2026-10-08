import * as vscode from 'vscode';
import { ChatMessage, chatSystemPrompt, databaseTools, runChatTurn } from '../ai-chat';
import { AiService } from '../ai-service';
import { ConnectionManager } from '../connections';
import { QueryEditors } from '../editor';
import { DbNode } from '../types';
import { bindRpc, webviewHtml, webviewOptions } from '../webviewHost';
import { aiContext } from './ai-panel';

const queriesKey = 'dbdeck.ai.chat.queries';
const PANEL_ROWS = 200;

export class ChatPanel {
  private static open = new Map<string, { panel: vscode.WebviewPanel; focus: (table?: string) => void }>();

  static async show(
    ctx: Pick<vscode.ExtensionContext, 'extensionUri' | 'globalState'>,
    manager: ConnectionManager,
    editors: QueryEditors,
    ai: AiService,
    node?: DbNode,
    beside = false,
  ): Promise<void> {
    const context = await aiContext(manager, editors, node, 'Chat with database');
    if (!context) return;
    const { db, database } = context;
    const config = manager.store.get(context.node.connId)!;
    const scope = { schema: context.node.table ? undefined : context.node.schema };
    const key = [config.id, database ?? '', scope.schema ?? ''].join('/');
    const focusName = (n: DbNode) => (n.table && n.kind !== 'routine' ? [n.schema, n.table].filter(Boolean).join('.') : undefined);
    const existing = ChatPanel.open.get(key);
    if (existing) {
      existing.focus(focusName(context.node));
      existing.panel.reveal(undefined, false);
      return;
    }
    let focus = focusName(context.node);
    const target: DbNode = { ...context.node, database };
    const allowed = () => ctx.globalState.get<string[]>(queriesKey, []).includes(config.id);
    const panel = vscode.window.createWebviewPanel(
      'dbdeck.chat',
      `Chat · ${config.name}`,
      beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      webviewOptions(ctx.extensionUri),
    );
    panel.iconPath = new vscode.ThemeIcon('sparkle');
    ChatPanel.open.set(key, {
      panel,
      focus: (table) => {
        focus = table;
        void panel.webview.postMessage({ type: 'chat:focus', table });
      },
    });
    const history: ChatMessage[] = [];
    let request: AbortController | undefined;
    const tools = databaseTools(db, scope, allowed, (event) => void panel.webview.postMessage({ type: 'chat:event', event }));
    const busy = (action: string) => {
      if (request) throw new Error(`Cancel the current answer before ${action}.`);
    };
    const subscriptions = bindRpc(panel.webview, {
      status: () => ai.status(),
      configure: async () => {
        busy('changing providers');
        await ai.configure();
        return ai.status();
      },
      signIn: async () => {
        busy('signing in');
        await ai.signIn();
        return ai.status();
      },
      model: async () => {
        busy('changing models');
        await ai.chooseModel();
        return ai.status();
      },
      disconnect: async () => {
        request?.abort();
        await ai.disconnect();
        return ai.status();
      },
      usage: () => vscode.env.openExternal(vscode.Uri.parse('https://chatgpt.com/settings/usage')),
      queries: async ({ on }: { on: boolean }) => {
        const others = ctx.globalState.get<string[]>(queriesKey, []).filter((id) => id !== config.id);
        if (on) {
          const answer = await vscode.window.showWarningMessage(
            `Let the AI assistant run read-only queries on "${config.name}"?`,
            {
              modal: true,
              detail:
                'The assistant can run read-only queries to answer your questions. Query results are sent to your AI provider. Inserts, updates, deletes and schema changes never run from the chat.',
            },
            'Allow',
          );
          if (answer !== 'Allow') return false;
        }
        await ctx.globalState.update(queriesKey, on ? [...others, config.id] : others);
        return on;
      },
      send: async ({ text }: { text: string }) => {
        busy('sending another message');
        if (typeof text !== 'string' || !text.trim() || text.length > 10000) throw new Error('Write a message of 1–10,000 characters.');
        const controller = new AbortController();
        request = controller;
        const mark = history.length;
        history.push({ role: 'user', content: text.trim() });
        try {
          const system = chatSystemPrompt({ connection: config.name, database, schema: scope.schema, table: focus, dialect: db.dialect, family: db.family }, allowed());
          return await runChatTurn((messages) => ai.chat(system, messages, tools.tools(), controller.signal), history, tools.execute, controller.signal);
        } catch (e) {
          history.length = mark;
          if (controller.signal.aborted) throw new Error('Answer cancelled.');
          throw e;
        } finally {
          request = undefined;
        }
      },
      cancel: () => request?.abort(),
      reset: () => {
        request?.abort();
        history.length = 0;
      },
      open: async ({ sql }: { sql: string }) => editors.newQuery(target, `${String(sql).trim()}\n`),
      run: async ({ sql }: { sql: string }) => {
        const r = await db.runReadOnly(String(sql));
        return { columns: r.columns.map((c) => c.name), rows: r.rows.slice(0, PANEL_ROWS), truncated: r.rows.length > PANEL_ROWS, durationMs: r.durationMs };
      },
      mcp: () => vscode.commands.executeCommand('dbdeck.mcpSetup'),
      close: () => panel.dispose(),
    });
    panel.onDidDispose(() => {
      ChatPanel.open.delete(key);
      request?.abort();
      subscriptions.dispose();
    });
    panel.webview.html = webviewHtml(panel.webview, ctx.extensionUri, 'chat', `Chat · ${config.name}`, {
      connection: config.name,
      location: [database, scope.schema].filter(Boolean).join(' › '),
      dialect: db.dialect,
      family: db.family,
      queries: allowed(),
      focus,
    });
  }
}
