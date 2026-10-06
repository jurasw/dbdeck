import * as vscode from 'vscode';
import { ConnectionManager } from '../connections';
import { SqlDriver } from '../drivers/sql';
import { loadSchemaDiagram } from '../schema-diagram';
import { DbNode } from '../types';
import { bindRpc, webviewHtml, webviewOptions } from '../webviewHost';

export class SchemaPanel {
  private static panels = new Map<string, vscode.WebviewPanel>();

  static async show(extUri: vscode.Uri, manager: ConnectionManager, node: DbNode): Promise<void> {
    if (!node.database || !['database', 'schema'].includes(node.kind)) throw new Error('Select a SQL database or schema in Connections.');
    const driver = await manager.get(node.connId);
    if (!(driver instanceof SqlDriver)) throw new Error('Schema diagrams are available for SQL databases.');
    const key = JSON.stringify([node.connId, node.database, node.schema]);
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }
    const title = `${node.schema ?? node.database} · Diagram`;
    const panel = vscode.window.createWebviewPanel('dbdeck.schema', title, vscode.ViewColumn.Active, webviewOptions(extUri));
    panel.iconPath = new vscode.ThemeIcon('type-hierarchy');
    this.panels.set(key, panel);
    const sub = bindRpc(panel.webview, {
      load: () => loadSchemaDiagram(driver, node.database!, node.schema),
    });
    panel.onDidDispose(() => {
      sub.dispose();
      this.panels.delete(key);
    });
    panel.webview.html = webviewHtml(panel.webview, extUri, 'schema', title, { title, dialect: driver.dialect });
  }
}
