import * as vscode from 'vscode';
import { AiService } from '../ai-service';
import { ConnectionStore } from '../connections';
import { bindRpc, webviewHtml, webviewOptions } from '../webviewHost';

const chatQueriesKey = 'dbdeck.ai.chat.queries';
const mcpAllowedKey = 'dbdeck.mcp.allowed';

const SETTINGS: Record<string, { type: 'number' | 'string' | 'boolean'; min?: number; max?: number }> = {
  pageSize: { type: 'number', min: 10, max: 10000 },
  maxResultRows: { type: 'number', min: 100, max: 1000000 },
  codeLens: { type: 'boolean' },
  redisScanLimit: { type: 'number', min: 100, max: 1000000 },
  redisKeySeparator: { type: 'string' },
  'mcp.enabled': { type: 'boolean' },
  'mcp.maxRows': { type: 'number', min: 1, max: 5000 },
};

const COMMANDS = new Set(['dbdeck.importConnections', 'dbdeck.exportConnections', 'dbdeck.mcpSetup']);

export class SettingsPanel {
  private static current?: vscode.WebviewPanel;

  static show(ctx: Pick<vscode.ExtensionContext, 'extensionUri' | 'globalState'>, store: ConnectionStore, ai: AiService): void {
    if (SettingsPanel.current) {
      SettingsPanel.current.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('dbdeck.settings', 'DBDeck Settings', vscode.ViewColumn.Active, webviewOptions(ctx.extensionUri));
    SettingsPanel.current = panel;
    panel.iconPath = new vscode.ThemeIcon('settings-gear');
    const names = (key: string) => {
      const ids = ctx.globalState.get<string[]>(key, []);
      return ids.flatMap((id) => {
        const c = store.get(id);
        return c ? [{ id, name: c.name }] : [];
      });
    };
    const state = async () => {
      const config = vscode.workspace.getConfiguration('dbdeck');
      return {
        ai: await ai.status(),
        settings: Object.fromEntries(Object.keys(SETTINGS).map((key) => [key, config.get(key)])),
        chat: names(chatQueriesKey),
        mcp: names(mcpAllowedKey),
        connections: store.list().length,
      };
    };
    const subscriptions = [
      bindRpc(panel.webview, {
        state,
        set: async ({ key, value }: { key: string; value: unknown }) => {
          const rule = SETTINGS[key];
          if (!rule) throw new Error(`Unknown setting ${key}`);
          if (rule.type === 'number') {
            const n = Number(value);
            if (!Number.isInteger(n) || n < rule.min! || n > rule.max!) throw new Error(`Use a whole number from ${rule.min} to ${rule.max}.`);
            value = n;
          } else if (rule.type === 'boolean') value = value === true;
          else if (typeof value !== 'string' || !value) throw new Error('Enter a value.');
          await vscode.workspace.getConfiguration('dbdeck').update(key, value, vscode.ConfigurationTarget.Global);
          return state();
        },
        ai: async ({ action }: { action: 'configure' | 'model' | 'signIn' | 'disconnect' }) => {
          if (action === 'configure') await ai.configure();
          else if (action === 'model') await ai.chooseModel();
          else if (action === 'signIn') await ai.signIn();
          else if (action === 'disconnect') await ai.disconnect();
          return state();
        },
        forget: async ({ list, id }: { list: 'chat' | 'mcp'; id?: string }) => {
          const key = list === 'chat' ? chatQueriesKey : mcpAllowedKey;
          await ctx.globalState.update(key, id ? ctx.globalState.get<string[]>(key, []).filter((x) => x !== id) : []);
          return state();
        },
        command: async ({ id }: { id: string }) => {
          if (!COMMANDS.has(id)) throw new Error(`Unknown command ${id}`);
          await vscode.commands.executeCommand(id);
          return state();
        },
        usage: () => vscode.env.openExternal(vscode.Uri.parse('https://chatgpt.com/settings/usage')),
        native: () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:dbdeck.dbdeck'),
      }),
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('dbdeck')) void panel.webview.postMessage({ type: 'settings:state', state: await state() });
      }),
    ];
    panel.onDidDispose(() => {
      SettingsPanel.current = undefined;
      for (const s of subscriptions) s.dispose();
    });
    panel.webview.html = webviewHtml(panel.webview, ctx.extensionUri, 'settings', 'DBDeck Settings', {});
  }
}
