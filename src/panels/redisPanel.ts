import * as vscode from 'vscode';
import { ConnectionManager } from '../connections';
import { RedisDriver } from '../drivers/redis';
import { bindRpc, webviewHtml, webviewOptions } from '../webviewHost';

export class RedisPanel {
  private static panels = new Map<string, vscode.WebviewPanel>();

  static async show(extUri: vscode.Uri, manager: ConnectionManager, connId: string, db: number, key: string, onChanged: () => void): Promise<void> {
    const id = `${connId}/${db}/${key}`;
    const existing = RedisPanel.panels.get(id);
    if (existing) {
      existing.reveal();
      return;
    }
    const driver = await manager.get<RedisDriver>(connId);
    const cfg = manager.store.get(connId)!;
    const panel = vscode.window.createWebviewPanel('dbdeck.redis', key, vscode.ViewColumn.Active, webviewOptions(extUri));
    panel.iconPath = new vscode.ThemeIcon('key');
    RedisPanel.panels.set(id, panel);
    let current = key;
    panel.webview.html = webviewHtml(panel.webview, extUri, 'redis', key, { key, db, location: `${cfg.name} › db${db}`, readonly: !!cfg.readonly });
    const sub = bindRpc(panel.webview, {
      load: ({ key }: { key: string }) => driver.getKey(db, key),
      exec: async ({ args }: { args: string[] }) => {
        const r = await driver.exec(db, args);
        const cmd = args[0].toUpperCase();
        if (cmd === 'RENAME') {
          RedisPanel.panels.delete(`${connId}/${db}/${current}`);
          current = args[2];
          panel.title = current;
          RedisPanel.panels.set(`${connId}/${db}/${current}`, panel);
        }
        if (cmd === 'RENAME' || cmd === 'DEL' || cmd === 'EXPIRE' || cmd === 'PERSIST') {
          driver.invalidate(db);
          onChanged();
        }
        if (cmd === 'DEL') panel.dispose();
        return r === null || r === undefined ? null : typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : String(r);
      },
      confirm: async ({ message, action }: { message: string; action: string }) => (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action,
      copy: ({ text }: { text: string }) => vscode.env.clipboard.writeText(text),
    });
    panel.onDidDispose(() => {
      sub.dispose();
      RedisPanel.panels.delete(`${connId}/${db}/${current}`);
    });
  }
}
