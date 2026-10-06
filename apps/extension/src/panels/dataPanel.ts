import * as vscode from 'vscode';
import { ConnectionManager } from '../connections';
import { ElasticDriver, errorText } from '../drivers/elastic';
import { docsToGrid, MongoDriver } from '../drivers/mongo';
import { PageOptions, RowChanges, SqlDriver } from '../drivers/sql';
import { DbNode, FAMILY, TableRef } from '../types';
import { bindRpc, saveExport, webviewHtml, webviewOptions } from '../webviewHost';
import { nodeId } from '../tree';

export class DataPanel {
  private static panels = new Map<string, vscode.WebviewPanel>();

  static async show(extUri: vscode.Uri, manager: ConnectionManager, n: DbNode, onChanged: () => void): Promise<void> {
    const key = nodeId(n);
    const existing = DataPanel.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }
    const cfg = manager.store.get(n.connId)!;
    const family = FAMILY[cfg.type];
    const driver = await manager.get(n.connId);
    const pageSize = vscode.workspace.getConfiguration('dbdeck').get<number>('pageSize') || 100;
    const title = n.table ?? n.label;
    const panel = vscode.window.createWebviewPanel('dbdeck.data', title, vscode.ViewColumn.Active, webviewOptions(extUri));
    panel.iconPath = new vscode.ThemeIcon(family === 'mongo' ? 'symbol-array' : family === 'es' ? 'symbol-file' : n.kind === 'view' ? 'eye' : 'table');
    DataPanel.panels.set(key, panel);
    const ref: TableRef = { database: n.database, schema: n.schema, table: n.table! };
    const location = [cfg.name, n.database, n.schema].filter(Boolean).join(' › ');
    const editable = !cfg.readonly && (family === 'mongo' || family === 'es' || (driver instanceof SqlDriver && driver.editable && n.kind === 'table'));

    panel.webview.html = webviewHtml(panel.webview, extUri, 'data', title, {
      mode: family,
      title,
      location,
      pageSize,
      editable,
      dialect: driver instanceof SqlDriver ? driver.dialect : undefined,
    });

    const common = {
      saveFile: async ({ name, content }: { name: string; content: string }) => saveExport(name, content),
      openInEditor: async ({ content, language }: { content: string; language: string }) => {
        const doc = await vscode.workspace.openTextDocument({ content, language });
        await vscode.window.showTextDocument(doc, { preview: false });
      },
      copy: async ({ text }: { text: string }) => vscode.env.clipboard.writeText(text),
      info: ({ message }: { message: string }) => vscode.window.showInformationMessage(message),
      confirm: async ({ message, action }: { message: string; action: string }) => (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action,
    };

    let handlers: Record<string, (p: any) => unknown>;
    if (driver instanceof SqlDriver) {
      handlers = {
        ...common,
        load: (o: PageOptions) => driver.page(ref, o),
        count: ({ where }: { where?: string }) => driver.count(ref, where),
        apply: async (ch: RowChanges) => {
          const n = await driver.apply(ref, ch);
          onChanged();
          return n;
        },
        ddl: () => driver.ddl(ref, n.kind),
        sql: (o: PageOptions) => driver.selectSql(ref, o),
        insertSql: ({ rows, columns }: { rows: unknown[][]; columns: string[] }) =>
          rows
            .map((r) => `INSERT INTO ${driver.qualified(ref)} (${columns.map((c) => driver.quote(c)).join(', ')}) VALUES (${r.map((v) => driver.literal(v)).join(', ')});`)
            .join('\n'),
      };
    } else if (driver instanceof MongoDriver) {
      const db = n.database!;
      const coll = n.table!;
      handlers = {
        ...common,
        load: async (o: { filter?: string; sort?: string; projection?: string; skip: number; limit: number }) => {
          const r = await driver.find(db, coll, o);
          return { ...docsToGrid(r.docs), docs: r.docs, durationMs: r.durationMs };
        },
        count: ({ filter }: { filter?: string }) => driver.count(db, coll, filter),
        replace: async ({ id, text }: { id: unknown; text: string }) => driver.replace(db, coll, id, text),
        insert: async ({ text }: { text: string }) => {
          await driver.insert(db, coll, text);
          onChanged();
        },
        remove: async ({ ids }: { ids: unknown[] }) => {
          const r = await driver.remove(db, coll, ids);
          onChanged();
          return r;
        },
        stats: () => driver.stats(db, coll),
      };
    } else if (driver instanceof ElasticDriver) {
      const index = n.table!;
      const enc = encodeURIComponent(index);
      const check = (r: { status: number; body: unknown }) => {
        if (r.status >= 400) throw new Error(errorText(r.body) || `HTTP ${r.status}`);
        return r.body;
      };
      handlers = {
        ...common,
        load: async (o: { query?: string; from: number; size: number; sort?: string }) => {
          const r = await driver.search(index, o);
          return { ...r, docs: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]]))) };
        },
        replace: async ({ id, text }: { id: string; text: string }) => {
          const doc = JSON.parse(text);
          delete doc._id;
          check(await driver.request('PUT', `/${enc}/_doc/${encodeURIComponent(id)}?refresh=wait_for`, doc));
        },
        insert: async ({ text }: { text: string }) => {
          const doc = JSON.parse(text);
          const id = doc._id;
          delete doc._id;
          check(await driver.request(id ? 'PUT' : 'POST', `/${enc}/_doc${id ? `/${encodeURIComponent(id)}` : ''}?refresh=wait_for`, doc));
          onChanged();
        },
        remove: async ({ ids }: { ids: string[] }) => {
          for (const id of ids) check(await driver.request('DELETE', `/${enc}/_doc/${encodeURIComponent(id)}?refresh=wait_for`));
          onChanged();
          return ids.length;
        },
        stats: async () => {
          const s = check(await driver.request('GET', `/${enc}/_stats/docs,store`)) as {
            _all?: { primaries?: { docs?: { count?: number }; store?: { size_in_bytes?: number } } };
          };
          const p = s._all?.primaries;
          return `${p?.docs?.count ?? 0} docs · ${((p?.store?.size_in_bytes ?? 0) / 1048576).toFixed(1)} MB`;
        },
        mapping: async () => JSON.stringify(check(await driver.request('GET', `/${enc}/_mapping`)), null, 2),
      };
    } else {
      throw new Error('Unsupported object');
    }
    const sub = bindRpc(panel.webview, handlers);
    panel.onDidDispose(() => {
      sub.dispose();
      DataPanel.panels.delete(key);
    });
  }
}
