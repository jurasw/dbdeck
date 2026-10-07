import * as vscode from 'vscode';
import { AiService } from '../ai-service';
import { QueryEditors } from '../editor';
import { AiPanel } from './ai-panel';
import { ConnectionManager } from '../connections';
import { ElasticDriver, errorText, SearchOptions } from '../drivers/elastic';
import { docsToGrid, FindOptions, MongoDriver } from '../drivers/mongo';
import { PageOptions, RowChanges, SqlDriver } from '../drivers/sql';
import { DbNode, FAMILY, TableRef } from '../types';
import { bindRpc, Handlers, saveExport, webviewHtml, webviewOptions } from '../webviewHost';
import { nodeId } from '../tree';

interface Session {
  title: string;
  icon: vscode.ThemeIcon;
  handlers: Promise<Handlers>;
  init(wait: number): Promise<Record<string, unknown> | undefined>;
  close(): void;
}

interface Timing {
  documentStart?: number;
  script?: number;
  shown: number;
  durationMs?: number;
}

let log: vscode.LogOutputChannel | undefined;

export interface RecentTable {
  node: DbNode;
  location: string;
}

interface Preview {
  panel: vscode.WebviewPanel;
  key: string;
  open(n: DbNode, onChanged: () => void): Promise<void>;
}

export class DataPanel {
  private static panels = new Map<string, vscode.WebviewPanel>();
  // Like an editor preview tab: opening another table swaps this panel's content instead of starting a new webview.
  private static preview: Preview | undefined;
  private static isolate = false;

  static async show(
    extUri: vscode.Uri,
    manager: ConnectionManager,
    n: DbNode,
    onChanged: () => void,
    ai?: AiService,
    editors?: QueryEditors,
    initialSearch?: string,
  ): Promise<void> {
    const search = initialSearch?.trim();
    // Search tabs keep existing filters and unsaved edits in the normal tab intact.
    const key = search ? JSON.stringify([nodeId(n), search]) : nodeId(n);
    const existing = DataPanel.panels.get(key);
    if (existing) {
      if (DataPanel.preview?.panel === existing) DataPanel.preview = undefined;
      existing.reveal();
      return;
    }
    const preview = search ? undefined : DataPanel.preview;
    if (preview) {
      DataPanel.panels.delete(preview.key);
      DataPanel.panels.set(key, preview.panel);
      preview.key = key;
      await preview.open(n, onChanged);
      return;
    }
    const { open } = DataPanel.create(extUri, manager, key, n.table ?? n.label, false, ai, editors, search);
    await open(n, onChanged, true);
  }

  static home(extUri: vscode.Uri, manager: ConnectionManager, recent: RecentTable[], onReady?: (panel: vscode.WebviewPanel) => void, ai?: AiService, editors?: QueryEditors): void {
    if (DataPanel.panels.size) return;
    const title = 'DBDeck';
    const { panel } = DataPanel.create(extUri, manager, 'home', title, true, ai, editors);
    panel.iconPath = new vscode.ThemeIcon('database');
    const ready = panel.webview.onDidReceiveMessage((m: { type?: string }) => {
      if (m?.type !== 'ready') return;
      ready.dispose();
      onReady?.(panel);
    });
    panel.webview.html = webviewHtml(panel.webview, extUri, 'data', title, { mode: 'home', recent });
  }

  private static create(
    extUri: vscode.Uri,
    manager: ConnectionManager,
    key: string,
    title: string,
    preserveFocus: boolean,
    ai?: AiService,
    editors?: QueryEditors,
    search?: string,
  ): { panel: vscode.WebviewPanel; open: (node: DbNode, changed: () => void, first: boolean) => Promise<void> } {
    const used = new Set([...DataPanel.panels.values()].map((p) => p.viewType));
    let viewType = 'dbdeck.data';
    for (let i = 2; DataPanel.isolate && used.has(viewType); i++) viewType = `dbdeck.data-${i}`;
    const panel = vscode.window.createWebviewPanel(viewType, title, { viewColumn: vscode.ViewColumn.Active, preserveFocus }, webviewOptions(extUri));
    DataPanel.panels.set(key, panel);
    let current: Session | undefined;
    const sub = bindRpc(panel.webview, () => current?.handlers ?? Promise.reject(new Error('Panel is closed')));
    let opening: { title: string; first: boolean; start: number; sent?: number } | undefined;
    const messages = panel.webview.onDidReceiveMessage((m: { type?: string; node?: DbNode } & Partial<Timing>) => {
      if (m?.type === 'pin' && DataPanel.preview?.panel === panel) DataPanel.preview = undefined;
      if (m?.type === 'open' && m.node) void vscode.commands.executeCommand('dbdeck.openTable', m.node);
      if (m?.type === 'worker') DataPanel.isolate = true;
      if (m?.type === 'timing' && opening?.sent && m.shown) {
        const o = opening;
        opening = undefined;
        const ms = (a: number, b: number) => `${Math.max(0, Math.round(b - a))} ms`;
        const steps = [`prepare ${ms(o.start, o.sent!)}`];
        if (m.documentStart && m.script) steps.push(`editor starts webview ${ms(o.sent!, m.documentStart)}`, `page loads ${ms(m.documentStart, m.script)}`);
        steps.push(`rows shown ${ms(m.script && o.first ? m.script : o.sent!, m.shown)}`);
        log ??= vscode.window.createOutputChannel('DBDeck', { log: true });
        log.info(
          `Opened ${o.title} in ${o.first ? 'a new' : 'the preview'} tab: ${ms(o.start, m.shown)} · ${steps.join(' · ')}${m.durationMs !== undefined ? ` · query ${Math.round(m.durationMs)} ms` : ''}`,
        );
      }
    });
    const open = async (node: DbNode, changed: () => void, first: boolean) => {
      const start = Date.now();
      current?.close();
      const s = (current = session(extUri, manager, node, changed, panel, ai, editors, search));
      panel.title = search ? `${s.title} · ${search}` : s.title;
      panel.iconPath = s.icon;
      if (!first) panel.reveal();
      // A fast first page travels with the HTML or mount message, avoiding a webview RPC round trip
      // and a skeleton-to-grid repaint. Cap the wait so slow connections still show UI.
      const init = await s.init(first ? 32 : 150);
      if (current !== s || !init) return;
      opening = { title: s.title, first, start, sent: Date.now() };
      if (first) panel.webview.html = webviewHtml(panel.webview, extUri, 'data', s.title, init);
      else void panel.webview.postMessage({ type: 'mount', init });
    };
    if (!search) DataPanel.preview = { panel, key, open: (node, changed) => open(node, changed, false) };
    panel.onDidDispose(() => {
      current?.close();
      current = undefined;
      sub.dispose();
      messages.dispose();
      for (const [k, p] of DataPanel.panels) if (p === panel) DataPanel.panels.delete(k);
      if (DataPanel.preview?.panel === panel) DataPanel.preview = undefined;
    });
    return { panel, open };
  }
}

function session(
  extUri: vscode.Uri,
  manager: ConnectionManager,
  n: DbNode,
  onChanged: () => void,
  panel: vscode.WebviewPanel,
  ai: AiService | undefined,
  editors: QueryEditors | undefined,
  search: string | undefined,
): Session {
  const cfg = manager.store.get(n.connId)!;
  const family = FAMILY[cfg.type];
  const pageSize = vscode.workspace.getConfiguration('dbdeck').get<number>('pageSize') || 100;
  const title = n.table ?? n.label;
  const ref: TableRef = { database: n.database, schema: n.schema, table: n.table! };
  const location = [cfg.name, n.database, n.schema].filter(Boolean).join(' › ');
  const editable = !cfg.readonly && (family === 'mongo' || family === 'es' || (family === 'sql' && (cfg.type === 'postgres' || cfg.type === 'mysql') && n.kind === 'table'));
  let disposed = false;
  const initialParams = family === 'sql' ? { limit: pageSize, offset: 0 } : family === 'mongo' ? { limit: pageSize, skip: 0 } : { size: pageSize, from: 0 };
  if (search) Object.assign(initialParams, { search });
  let initialPage: Promise<unknown> | undefined;

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

  const handlersReady = (async () => {
    const driver = await manager.get(n.connId);
    let handlers: Record<string, (p: any) => unknown>;
    if (driver instanceof SqlDriver) {
      handlers = {
        ...common,
        aiFilter: async ({ prompt }: { prompt: string }) => {
          if (!ai || !editors) throw new Error('AI is unavailable.');
          const status = await ai.status();
          if (!status.connected || !status.model) {
            await AiPanel.show({ extensionUri: extUri }, manager, editors, ai, n, () => panel.reveal());
            return null;
          }
          if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Describe the filter in the WHERE field first.');
          const columns = await driver.columns(ref);
          const schema = JSON.stringify({ table: ref.table, schema: ref.schema, columns: columns.map((c) => ({ name: c.name, type: c.type })) });
          return ai.generate(prompt, schema, driver.dialect, new AbortController().signal, true);
        },
        load: (o: PageOptions) => driver.page(ref, o),
        count: ({ where, search }: { where?: string; search?: string }) => driver.count(ref, where, search),
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
        load: async (o: FindOptions) => {
          const r = await driver.find(db, coll, o);
          return { ...docsToGrid(r.docs), docs: r.docs, durationMs: r.durationMs, total: r.total };
        },
        count: ({ filter, search }: { filter?: string; search?: string }) => driver.count(db, coll, filter, search),
        replace: async ({ id, text }: { id: unknown; text: string }) => driver.replace(db, coll, id, text),
        updateField: ({ id, field, text }: { id: unknown; field: string; text: string }) => driver.updateField(db, coll, id, field, text),
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
        load: async (o: SearchOptions) => {
          const r = await driver.search(index, o);
          return { ...r, docs: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]]))) };
        },
        replace: async ({ id, text }: { id: string; text: string }) => {
          const doc = JSON.parse(text);
          delete doc._id;
          check(await driver.request('PUT', `/${enc}/_doc/${encodeURIComponent(id)}?refresh=wait_for`, doc));
        },
        updateField: async ({ id, field, text }: { id: string; field: string; text: string }) => {
          if (!field || field === '_id') throw new Error('This field cannot be edited inline');
          if (typeof id !== 'string' || !id) throw new Error('Document ID is missing');
          check(
            await driver.request('POST', `/${enc}/_update/${encodeURIComponent(id)}?refresh=wait_for`, {
              script: { source: 'ctx._source[params.field] = params.value', lang: 'painless', params: { field, value: JSON.parse(text) } },
            }),
          );
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
    // Fetch while the editor starts the webview, instead of waiting for its first RPC.
    const load = handlers.load;
    if (!disposed) {
      initialPage = Promise.resolve().then(() => load(initialParams));
      void initialPage.catch(() => undefined);
    }
    return {
      ...handlers,
      load: (params: unknown) => {
        initialPage = undefined;
        return load(params);
      },
      initialLoad: () => {
        const result = initialPage;
        initialPage = undefined;
        return result ?? handlers.load(initialParams);
      },
    };
  })();
  // RPC reports connection errors in the panel, including before its first request.
  void handlersReady.catch(() => undefined);
  return {
    title,
    icon: new vscode.ThemeIcon(family === 'mongo' ? 'symbol-array' : family === 'es' ? 'symbol-file' : n.kind === 'view' ? 'eye' : 'table'),
    handlers: handlersReady,
    init: async (wait) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const initialData = await Promise.race([
        handlersReady.then(() => initialPage).catch(() => undefined),
        new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), wait))),
      ]);
      clearTimeout(timer);
      if (disposed) return undefined;
      return { mode: family, title, location, pageSize, editable, dialect: family === 'sql' ? cfg.type : undefined, initialSearch: search, initialData };
    },
    close: () => {
      disposed = true;
      initialPage = undefined;
    },
  };
}
