import * as vscode from 'vscode';
import { ConnectionManager } from './connections';
import { ElasticDriver, errorText } from './drivers/elastic';
import { docsToGrid, MongoDriver } from './drivers/mongo';
import { SqlDriver } from './drivers/sql';
import { ResultsView } from './panels/resultsView';
import { splitSql, statementAt, Statement } from './sqlSplit';
import { ConnectionConfig, DbNode, FAMILY, QueryResult } from './types';
import { errorMessage } from './util';

interface Binding {
  connId: string;
  database?: string;
  schema?: string;
}

const LANGUAGE = { sql: 'sql', mongo: 'javascript', es: 'dbdeck-es' } as const;
const SQL_KEYWORDS =
  'SELECT FROM WHERE AND OR NOT IN IS NULL LIKE ILIKE BETWEEN EXISTS JOIN LEFT RIGHT INNER OUTER FULL CROSS ON USING GROUP BY ORDER HAVING LIMIT OFFSET UNION ALL DISTINCT AS CASE WHEN THEN ELSE END INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW INDEX DROP ALTER ADD COLUMN PRIMARY KEY FOREIGN REFERENCES DEFAULT CONSTRAINT UNIQUE CHECK RETURNING WITH RECURSIVE TRUNCATE BEGIN COMMIT ROLLBACK EXPLAIN ANALYZE COUNT SUM AVG MIN MAX COALESCE CAST NOW ASC DESC TRUE FALSE'.split(' ');

export class QueryEditors implements vscode.Disposable {
  private bindings = new Map<string, Binding>();
  private status: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];
  private lensEmitter = new vscode.EventEmitter<void>();
  private schemaCache = new Map<string, Promise<{ name: string; schema?: string }[]>>();
  private columnCache = new Map<string, Promise<string[]>>();

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly manager: ConnectionManager,
    private readonly results: ResultsView,
  ) {
    this.bindings = new Map(Object.entries(ctx.workspaceState.get<Record<string, Binding>>('dbdeck.bindings', {})));
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.status.command = 'dbdeck.selectConnection';
    this.disposables.push(
      this.status,
      vscode.window.onDidChangeActiveTextEditor(() => this.updateStatus()),
      vscode.workspace.onDidCloseTextDocument((d) => {
        if (d.isUntitled && this.bindings.delete(d.uri.toString())) void this.persist();
      }),
      vscode.languages.registerCodeLensProvider([{ language: 'sql' }, { language: 'dbdeck-es' }, { language: 'javascript' }], {
        onDidChangeCodeLenses: this.lensEmitter.event,
        provideCodeLenses: (doc) => this.lenses(doc),
      }),
      vscode.languages.registerCompletionItemProvider({ language: 'sql' }, { provideCompletionItems: (doc, pos) => this.complete(doc, pos) }, '.'),
      manager.onDidChange(() => this.schemaCache.clear()),
    );
    this.updateStatus();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  private async persist(): Promise<void> {
    await this.ctx.workspaceState.update('dbdeck.bindings', Object.fromEntries(this.bindings));
  }

  binding(doc: vscode.TextDocument): Binding | undefined {
    const b = this.bindings.get(doc.uri.toString());
    if (b && this.manager.store.get(b.connId)) return b;
    return undefined;
  }

  async bind(doc: vscode.TextDocument, b: Binding): Promise<void> {
    this.bindings.set(doc.uri.toString(), b);
    await this.persist();
    this.updateStatus();
    this.lensEmitter.fire();
  }

  private updateStatus(): void {
    const ed = vscode.window.activeTextEditor;
    const doc = ed?.document;
    const b = doc ? this.binding(doc) : undefined;
    const eligible = !!doc && (doc.languageId === 'sql' || doc.languageId === 'dbdeck-es' || !!b);
    void vscode.commands.executeCommand('setContext', 'dbdeck.boundEditor', eligible);
    if (!eligible) {
      this.status.hide();
      return;
    }
    const cfg = b ? this.manager.store.get(b.connId) : undefined;
    this.status.text = cfg ? `$(database) ${cfg.name}${b?.database ? ` › ${b.database}` : ''}` : '$(database) Select connection';
    this.status.tooltip = 'DBDeck: change the connection used by this editor';
    this.status.show();
  }

  async newQuery(n: DbNode, content?: string): Promise<void> {
    const cfg = this.manager.store.get(n.connId);
    if (!cfg) return;
    const family = FAMILY[cfg.type];
    if (family !== 'sql' && family !== 'mongo' && family !== 'es') return;
    const database = n.database ?? (await this.defaultDatabase(cfg));
    const text = content ?? template(cfg, database, n);
    const doc = await vscode.workspace.openTextDocument({ language: LANGUAGE[family], content: text });
    await this.bind(doc, { connId: cfg.id, database, schema: n.schema });
    const ed = await vscode.window.showTextDocument(doc, { preview: false });
    const end = doc.positionAt(text.length);
    ed.selection = new vscode.Selection(end, end);
  }

  private async defaultDatabase(cfg: ConnectionConfig): Promise<string | undefined> {
    if (cfg.database) return cfg.database;
    if (cfg.type === 'postgres') return 'postgres';
    return undefined;
  }

  async selectConnection(doc?: vscode.TextDocument): Promise<Binding | undefined> {
    doc ??= vscode.window.activeTextEditor?.document;
    if (!doc) return;
    const wanted = doc.languageId === 'dbdeck-es' ? ['es'] : doc.languageId === 'javascript' ? ['mongo'] : doc.languageId === 'sql' ? ['sql'] : ['sql', 'mongo', 'es'];
    const conns = this.manager.store.list().filter((c) => wanted.includes(FAMILY[c.type]));
    if (!conns.length) {
      void vscode.window.showWarningMessage('No matching connections. Add one in the DBDeck view first.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      conns.map((c) => ({ label: c.name, description: c.type, detail: [c.host, c.database].filter(Boolean).join(' · '), c })),
      { placeHolder: 'Connection for this editor' },
    );
    if (!pick) return;
    let database: string | undefined;
    if (FAMILY[pick.c.type] !== 'es') {
      const driver = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Connecting ${pick.c.name}` }, () =>
        this.manager.get(pick.c.id),
      );
      const dbs = driver instanceof SqlDriver || driver instanceof MongoDriver ? await driver.databases() : [];
      if (dbs.length === 1) database = dbs[0];
      else {
        database = await vscode.window.showQuickPick(dbs, { placeHolder: 'Database' });
        if (!database) return;
      }
    }
    const b = { connId: pick.c.id, database };
    await this.bind(doc, b);
    return b;
  }

  async run(all: boolean, arg?: { uri: string; offset: number }): Promise<void> {
    const ed = arg ? vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === arg.uri) : vscode.window.activeTextEditor;
    if (!ed) return;
    const doc = ed.document;
    const b = this.binding(doc) ?? (await this.selectConnection(doc));
    if (!b) return;
    const cfg = this.manager.store.get(b.connId)!;
    const family = FAMILY[cfg.type];
    const location = [cfg.name, b.database].filter(Boolean).join(' › ');
    const sel = ed.selection;
    const text = doc.getText();
    const offset = arg?.offset ?? doc.offsetAt(sel.active);
    const selected = !arg && !sel.isEmpty ? doc.getText(sel) : undefined;

    try {
      const driver = await this.manager.get(b.connId);
      let pieces: string[];
      if (driver instanceof SqlDriver) {
        const stmts = splitSql(selected ?? text, driver.dialect);
        pieces = selected || all ? stmts.map((s) => s.text) : [statementAt(stmts, offset)?.text].filter(Boolean) as string[];
      } else if (driver instanceof ElasticDriver) {
        const reqs = parseEsRequests(selected ?? text);
        pieces = (selected || all ? reqs : [reqs.find((r) => offset >= r.start && offset <= r.end) ?? reqs.filter((r) => r.start <= offset).pop() ?? reqs[0]])
          .filter(Boolean)
          .map((r) => r.text);
      } else {
        pieces = [selected ?? (all ? text : blockAt(text, offset))];
      }
      pieces = pieces.filter((p) => p?.trim());
      if (!pieces.length) {
        void vscode.window.showInformationMessage('Nothing to run.');
        return;
      }
      await this.results.running(location, pieces.length > 1 ? `${pieces.length} statements` : pieces[0].slice(0, 120));
      const out: QueryResult[] = [];
      const max = vscode.workspace.getConfiguration('dbdeck').get<number>('maxResultRows') || 5000;
      for (const p of pieces) {
        try {
          let r: QueryResult;
          if (driver instanceof SqlDriver) r = await driver.run(p, b.database);
          else if (driver instanceof MongoDriver) r = await driver.script(b.database ?? 'test', p);
          else if (driver instanceof ElasticDriver) r = await runEs(driver, p);
          else throw new Error('Queries are not supported for this connection');
          if (r.rows.length > max) {
            r.rows = r.rows.slice(0, max);
            r.truncated = true;
          }
          out.push({ ...r, sql: p });
        } catch (e) {
          out.push({ columns: [], rows: [], durationMs: 0, sql: p, error: errorMessage(e) });
          if (family === 'sql') break;
        }
      }
      if (out.some((r) => !r.error && /^\s*(create|drop|alter|rename|truncate)\b/i.test(r.sql ?? ''))) {
        this.schemaCache.clear();
        this.columnCache.clear();
        void vscode.commands.executeCommand('dbdeck.refresh');
      }
      await this.results.show({ location, results: out });
    } catch (e) {
      await this.results.show({ location, results: [{ columns: [], rows: [], durationMs: 0, error: errorMessage(e) }] });
    }
  }

  private lenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('dbdeck').get<boolean>('codeLens')) return [];
    const b = this.binding(doc);
    if (!b && doc.languageId !== 'dbdeck-es') return [];
    const cfg = b ? this.manager.store.get(b.connId) : undefined;
    const text = doc.getText();
    if (text.length > 500000) return [];
    let ranges: { start: number }[] = [];
    if (doc.languageId === 'sql') ranges = splitSql(text, cfg?.type === 'mysql' ? 'mysql' : cfg?.type === 'clickhouse' ? 'clickhouse' : 'postgres');
    else if (doc.languageId === 'dbdeck-es') ranges = parseEsRequests(text);
    else return [];
    return ranges.map((s: { start: number }) => {
      const pos = doc.positionAt(s.start);
      return new vscode.CodeLens(new vscode.Range(pos, pos), {
        title: '$(play) Run',
        command: 'dbdeck.runQuery',
        arguments: [{ uri: doc.uri.toString(), offset: s.start }],
      });
    });
  }

  private async complete(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.CompletionItem[]> {
    const b = this.binding(doc);
    const items: vscode.CompletionItem[] = [];
    const line = doc.lineAt(pos.line).text.slice(0, pos.character);
    const dot = /([\w$"`]+)\.\w*$/.exec(line);
    if (b) {
      try {
        const driver = await this.manager.get(b.connId);
        if (driver instanceof SqlDriver) {
          const key = `${b.connId}/${b.database}`;
          if (!this.schemaCache.has(key)) this.schemaCache.set(key, driver.objects(b.database).catch(() => []));
          const tables = await this.schemaCache.get(key)!;
          if (dot) {
            const word = dot[1].replace(/["`]/g, '');
            const resolved = resolveAlias(doc.getText(), word) ?? word;
            const t = tables.find((x) => x.name === resolved);
            if (t) {
              const ck = `${key}/${t.schema}/${t.name}`;
              if (!this.columnCache.has(ck))
                this.columnCache.set(ck, driver.columns({ database: b.database, schema: t.schema, table: t.name }).then((c) => c.map((x) => x.name)).catch(() => []));
              for (const c of await this.columnCache.get(ck)!) items.push(new vscode.CompletionItem(c, vscode.CompletionItemKind.Field));
              return items;
            }
            const inSchema = tables.filter((x) => x.schema === word);
            for (const t of inSchema) items.push(new vscode.CompletionItem(t.name, vscode.CompletionItemKind.Class));
            if (items.length) return items;
          }
          for (const t of tables) {
            const it = new vscode.CompletionItem(t.name, vscode.CompletionItemKind.Class);
            it.detail = t.schema;
            items.push(it);
          }
        }
      } catch {
        return [];
      }
    }
    if (!dot) for (const k of SQL_KEYWORDS) items.push(new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
    return items;
  }
}

function resolveAlias(text: string, alias: string): string | undefined {
  const re = new RegExp(`(?:from|join|update|into)\\s+(?:[\\w"\`]+\\.)?["\`]?(\\w+)["\`]?\\s+(?:as\\s+)?${alias}\\b`, 'i');
  return re.exec(text)?.[1];
}

function blockAt(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const s = before.search(/\n\s*\n(?![\s\S]*\n\s*\n)/);
  const start = s === -1 ? 0 : s;
  const e = after.search(/\n\s*\n/);
  return text.slice(start, e === -1 ? text.length : offset + e).trim();
}

export function parseEsRequests(text: string): (Statement & { method: string; path: string; body: string })[] {
  const out: (Statement & { method: string; path: string; body: string })[] = [];
  const re = /^[ \t]*(GET|POST|PUT|DELETE|HEAD|PATCH)[ \t]+(\S+)[^\n]*$/gim;
  const heads = [...text.matchAll(re)];
  heads.forEach((m, i) => {
    const start = m.index!;
    const end = i + 1 < heads.length ? heads[i + 1].index! - 1 : text.length;
    const body = text
      .slice(start + m[0].length, end)
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')
      .trim();
    out.push({ text: text.slice(start, end).trim(), start, end, method: m[1].toUpperCase(), path: m[2], body });
  });
  return out;
}

async function runEs(driver: ElasticDriver, text: string): Promise<QueryResult> {
  const [req] = parseEsRequests(text);
  if (!req) throw new Error('Expected a request like: GET /index/_search');
  let body: string | undefined = req.body || undefined;
  if (body && !/_bulk|_msearch/.test(req.path)) JSON.parse(body);
  if (body && /_bulk|_msearch/.test(req.path)) {
    body = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
  }
  const r = await driver.request(req.method, req.path, body);
  if (r.status >= 400) throw new Error(`${r.status} ${errorText(r.body)}`);
  const res: QueryResult = { columns: [], rows: [], durationMs: r.durationMs, json: r.body, message: `HTTP ${r.status}` };
  const hits = (r.body as { hits?: { hits?: { _id: string; _index: string; _score: number; _source?: object }[] } })?.hits?.hits;
  if (Array.isArray(hits)) Object.assign(res, docsToGrid(hits.map((h) => ({ _id: h._id, _index: h._index, _score: h._score, ...h._source }))));
  else if (Array.isArray(r.body) && r.body.length && typeof r.body[0] === 'object') Object.assign(res, docsToGrid(r.body));
  else if (typeof r.body === 'string') {
    const lines = r.body.replace(/\n$/, '').split('\n');
    Object.assign(res, { columns: [{ name: 'response' }], rows: lines.map((l) => [l]), json: undefined });
  }
  return res;
}

function template(cfg: ConnectionConfig, database: string | undefined, n: DbNode): string {
  const family = FAMILY[cfg.type];
  if (family === 'mongo') {
    return n.kind === 'collection'
      ? `db.getCollection('${n.table}').find({}).limit(50)\n`
      : `// ${cfg.name}${database ? ` › ${database}` : ''}\n// Run the block under the cursor with ⌘/Ctrl+Enter. The last expression is shown in Results.\n\ndb.getCollectionNames()\n`;
  }
  if (family === 'es') {
    return n.kind === 'esIndex'
      ? `GET /${n.table}/_search\n{\n  "query": { "match_all": {} },\n  "size": 20\n}\n`
      : `# ${cfg.name}\n# Put the cursor inside a request and press ⌘/Ctrl+Enter.\n\nGET /_cluster/health\n\nGET /_cat/indices?v&s=index\n\nGET /my-index/_search\n{\n  "query": { "match_all": {} }\n}\n`;
  }
  return `-- ${cfg.name}${database ? ` › ${database}` : ''}${n.schema ? ` › ${n.schema}` : ''}\n\n`;
}
