// Platform adapter: the production extension runs unchanged in a disposable
// local worker. Every UI operation is transported to its browser client.
import { parentPort, workerData } from "node:worker_threads";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as pty from "node-pty";

export class Disposable {
  constructor(private fn = () => {}) {}
  dispose() {
    this.fn();
  }
  static from(...items: any[]) {
    return new Disposable(() => items.forEach((i) => i.dispose()));
  }
}
export class EventEmitter<T = any> {
  private listeners = new Set<(event: T) => unknown>();
  event = (fn: (event: T) => unknown) => {
    this.listeners.add(fn);
    return new Disposable(() => this.listeners.delete(fn));
  };
  fire(event?: T) {
    for (const fn of this.listeners) fn(event as T);
  }
  dispose() {
    this.listeners.clear();
  }
}
export class Uri {
  constructor(readonly value: string) {}
  get fsPath() {
    return this.value.startsWith("file:")
      ? fileURLToPath(this.value)
      : this.value;
  }
  get scheme() {
    return this.value.split(":")[0];
  }
  get path() {
    return this.value.startsWith("file:")
      ? this.fsPath
      : new URL(this.value).pathname;
  }
  toString() {
    return this.value;
  }
  toJSON() {
    return this.value;
  }
  static parse(value: string) {
    return new Uri(value);
  }
  static file(value: string) {
    return new Uri(pathToFileURL(value).href);
  }
  static joinPath(base: Uri, ...parts: string[]) {
    return Uri.file(join(base.fsPath, ...parts));
  }
}
export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
  translate(lineDelta = 0, characterDelta = 0) {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }
}
export class Range {
  start: Position;
  end: Position;
  constructor(
    a: Position | number,
    b: Position | number,
    c?: number,
    d?: number,
  ) {
    this.start = typeof a === "number" ? new Position(a, b as number) : a;
    this.end = typeof c === "number" ? new Position(c, d!) : (b as Position);
  }
}
export class Selection extends Range {
  anchor: Position;
  active: Position;
  constructor(a: Position, b: Position) {
    super(a, b);
    this.anchor = a;
    this.active = b;
  }
  get isEmpty() {
    return (
      this.anchor.line === this.active.line &&
      this.anchor.character === this.active.character
    );
  }
}
export class ThemeIcon {
  constructor(
    public id: string,
    public color?: any,
  ) {}
}
export class ThemeColor {
  constructor(public id: string) {}
}
export class TreeItem {
  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}
export class TabInputText {
  constructor(public uri: Uri) {}
}
export class CodeLens {
  constructor(
    public range: Range,
    public command: any,
  ) {}
}
export class CompletionItem {
  constructor(
    public label: string,
    public kind?: number,
  ) {}
}
export const CompletionItemKind = { Class: 7, Field: 5, Keyword: 14 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const StatusBarAlignment = { Left: 1 };
export const ProgressLocation = { Notification: 15, Window: 10 };
export const ConfigurationTarget = { Global: 1 };
export const ViewColumn = { Active: 1, Beside: 2 };
export const UIKind = { Web: 2 };
export const emit = (event: any) =>
  parentPort!.postMessage({ type: "event", event });

const state = structuredClone(workerData.snapshot ?? {});
const configuration = workerData.configuration ?? {};
state.globals ??= {};
state.secrets ??= {};
state.workspace ??= {};
state.config ??= {};
const snapshot = () => emit({ type: "snapshot", snapshot: state });
function memento(key: string) {
  return {
    get: (name: string, fallback?: any) => state[key][name] ?? fallback,
    update: async (name: string, value: any) => {
      if (value === undefined) delete state[key][name];
      else state[key][name] = value;
      snapshot();
    },
  };
}
export const context = {
  subscriptions: [] as any[],
  extensionUri: Uri.file(workerData.extensionPath),
  globalStorageUri: Uri.file(workerData.tempPath),
  globalState: memento("globals"),
  workspaceState: memento("workspace"),
  extension: { packageJSON: { version: workerData.version } },
  secrets: {
    get: async (name: string) => state.secrets[name],
    store: async (name: string, value: string) => {
      state.secrets[name] = value;
      snapshot();
    },
    delete: async (name: string) => {
      delete state.secrets[name];
      snapshot();
    },
  },
};
const downloads = new Set<string>();
const transferDir = () => join(workerData.tempPath, "transfers", randomUUID());
let requestId = 0;
const requests = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
function request(kind: string, options: any) {
  const id = ++requestId;
  emit({ type: "request", id, kind, options });
  return new Promise<any>((resolve, reject) =>
    requests.set(id, { resolve, reject }),
  );
}
const handlers = new Map<string, (...args: any[]) => any>();
const providers = new Map<string, any>();
export const panels = new Map<string, any>();
export let tree: any;
const activeEditorChanged = new EventEmitter();
const documentClosed = new EventEmitter();
const configChanged = new EventEmitter();
let panelSeq = 0;
const theme = readFileSync(workerData.themePath, "utf8");
function panel(viewType: string, title: string) {
  const id = `panel-${++panelSeq}`;
  const received = new EventEmitter();
  const disposed = new EventEmitter();
  const messages: any[] = [];
  let html = "";
  let isReady = false;
  const p: any = {
    id,
    viewType,
    title,
    visible: true,
    onDidDispose: disposed.event,
    reveal: () => {
      emit({ type: "panel-reveal", id });
    },
    show: () => {
      emit({ type: "panel-reveal", id });
    },
    dispose: () => {
      disposed.fire();
      panels.delete(id);
      emit({ type: "panel-close", id });
    },
    webview: {
      options: {},
      cspSource: workerData.origin,
      asWebviewUri: (uri: Uri) =>
        Uri.parse(
          `${workerData.origin}/extension/${relative(workerData.extensionPath, uri.fsPath).split("\\").join("/")}`,
        ),
      onDidReceiveMessage: received.event,
      postMessage: async (message: any) => {
        if (isReady) emit({ type: "panel-message", id, message });
        else messages.push(message);
        return true;
      },
      get html() {
        return html;
      },
      set html(value: string) {
        isReady = false;
        const bootstrap = `globalThis.acquireVsCodeApi=()=>({postMessage:message=>parent.postMessage({type:'dbdeck-webview',panelId:${JSON.stringify(id)},message},${JSON.stringify(workerData.origin)}),getState:()=>undefined,setState:()=>{}});let lastActivity=0;for(const kind of ['pointerdown','pointermove','keydown'])document.addEventListener(kind,()=>{if(Date.now()-lastActivity>500){lastActivity=Date.now();parent.postMessage({type:'dbdeck-webview',panelId:${JSON.stringify(id)},activity:true},${JSON.stringify(workerData.origin)});}});`;
        html = value
          .replace("window.__INIT__ =", `${bootstrap}window.__INIT__ =`)
          .replace("</head>", `<style>${theme}</style></head>`)
          .replace("<body>", '<body class="vscode-dark">');
        emit({ type: "panel-html", id, title: p.title, viewType, html });
      },
    },
    receive: (message: any) => received.fire(message),
    ready: () => {
      isReady = true;
      for (const message of messages.splice(0))
        emit({ type: "panel-message", id, message });
    },
  };
  panels.set(id, p);
  return p;
}
let documentSeq = Math.max(
  0,
  ...(state.documents ?? []).map((doc: any) =>
    Number(/untitled:query-(\d+)$/.exec(doc.id)?.[1] ?? 0),
  ),
);
const documents = new Map<string, any>();
const savedDocuments = structuredClone(state.documents ?? []);
function saveDocuments() {
  state.documents = [...documents.values()].map((doc) => ({
    id: doc.uri.toString(),
    text: doc.content,
    language: doc.languageId,
  }));
  snapshot();
}
function document(
  content: string,
  language = "sql",
  uri = new Uri(`untitled:query-${++documentSeq}`),
) {
  const doc: any = {
    uri,
    languageId: language,
    isUntitled: uri.scheme === "untitled",
    content,
    getText: (range?: Range) =>
      range
        ? doc.content.slice(doc.offsetAt(range.start), doc.offsetAt(range.end))
        : doc.content,
    positionAt: (offset: number) => {
      const lines = doc.content.slice(0, offset).split("\n");
      return new Position(lines.length - 1, lines.at(-1)!.length);
    },
    offsetAt: (pos: Position) =>
      doc.content
        .split("\n")
        .slice(0, pos.line)
        .reduce((n: number, line: string) => n + line.length + 1, 0) +
      pos.character,
    lineAt: (line: number | Position) => ({
      text:
        doc.content.split("\n")[typeof line === "number" ? line : line.line] ??
        "",
    }),
    get lineCount() {
      return doc.content.split("\n").length;
    },
  };
  documents.set(uri.toString(), doc);
  saveDocuments();
  return doc;
}
const terminals = new Map<string, any>();
export const commands = {
  registerCommand: (name: string, fn: (...args: any[]) => any) => {
    handlers.set(name, fn);
    return new Disposable(() => handlers.delete(name));
  },
  executeCommand: async (name: string, ...args: any[]) => {
    if (name === "setContext") return;
    if (handlers.has(name)) return handlers.get(name)!(...args);
    if (name === "vscode.open" && args[0]) {
      const uri = typeof args[0] === "string" ? Uri.parse(args[0]) : args[0];
      if (uri.scheme === "file")
        return window.showTextDocument(await workspace.openTextDocument(uri));
      return env.openExternal(uri);
    }
    if (name.endsWith(".focus")) {
      const provider = providers.get(name.slice(0, -6));
      if (provider) {
        const p = panel(name.slice(0, -6), "Results");
        provider.resolveWebviewView(p);
      }
      return;
    }
    if (name.startsWith("workbench.")) return;
    throw new Error(`Unsupported command: ${name}`);
  },
};
export const env = {
  uiKind: UIKind.Web,
  appName: "DBDeck Dashboard",
  clipboard: {
    writeText: async (text: string) => {
      await request("clipboard", { text });
    },
  },
  openExternal: async (uri: Uri) => {
    emit({ type: "external", url: uri.toString() });
    return true;
  },
};
export const workspace = {
  workspaceFolders: undefined,
  onDidChangeConfiguration: configChanged.event,
  onDidCloseTextDocument: documentClosed.event,
  getConfiguration: (section: string) => ({
    get: (name: string, fallback?: any) =>
      state.config[`${section}.${name}`] ??
      configuration[`${section}.${name}`]?.default ??
      fallback,
    update: async (name: string, value: any) => {
      state.config[`${section}.${name}`] = value;
      snapshot();
      configChanged.fire({
        affectsConfiguration: (key: string) => key === `${section}.${name}`,
      });
    },
  }),
  fs: {
    readFile: (uri: Uri) => readFile(uri.fsPath),
    writeFile: async (uri: Uri, content: Uint8Array) => {
      await mkdir(dirname(uri.fsPath), { recursive: true });
      await writeFile(uri.fsPath, content);
      if (downloads.delete(uri.fsPath))
        emit({
          type: "download",
          name: basename(uri.fsPath),
          data: Buffer.from(content).toString("base64"),
        });
    },
  },
  openTextDocument: async (input: any) =>
    input instanceof Uri
      ? document(await readFile(input.fsPath, "utf8"), "plaintext", input)
      : document(input.content ?? "", input.language),
};
const completionProviders = new Set<any>();
const lensProviders = new Set<any>();
export const languages = {
  registerCodeLensProvider: (_selector: any, provider: any) => {
    lensProviders.add(provider);
    const changed = provider.onDidChangeCodeLenses?.(() =>
      emit({ type: "editor-services-changed" }),
    );
    return new Disposable(() => {
      lensProviders.delete(provider);
      changed?.dispose();
    });
  },
  registerCompletionItemProvider: (_selector: any, provider: any) => {
    completionProviders.add(provider);
    return new Disposable(() => completionProviders.delete(provider));
  },
};
export const window: any = {
  activeTextEditor: undefined,
  visibleTextEditors: [],
  onDidChangeActiveTextEditor: activeEditorChanged.event,
  tabGroups: { activeTabGroup: { tabs: [], viewColumn: 1 } },
  createTreeView: (_id: string, options: any) => {
    const changed = new EventEmitter();
    tree = {
      provider: options.treeDataProvider,
      selection: [],
      visible: true,
      onDidChangeVisibility: changed.event,
      dispose() {},
    };
    tree.provider.onDidChangeTreeData(() => emit({ type: "tree-changed" }));
    return tree;
  },
  createWebviewPanel: (type: string, title: string) => panel(type, title),
  registerWebviewViewProvider: (id: string, provider: any) => {
    providers.set(id, provider);
    return new Disposable(() => providers.delete(id));
  },
  createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
  createOutputChannel: () => ({ info() {}, appendLine() {}, dispose() {} }),
  setStatusBarMessage: (message: string) => {
    emit({ type: "notice", message });
    return new Disposable();
  },
  withProgress: (_options: any, task: any) =>
    task(
      { report() {} },
      {
        isCancellationRequested: false,
        onCancellationRequested: () => new Disposable(),
      },
    ),
  showErrorMessage: (message: string) => {
    emit({ type: "notice", message, error: true });
    return Promise.resolve(undefined);
  },
  showInformationMessage: (message: string, ...actions: any[]) =>
    actions.length
      ? request("message", { message, actions })
      : (emit({ type: "notice", message }), Promise.resolve(undefined)),
  showWarningMessage: (message: string, options: any, ...actions: string[]) =>
    request("message", {
      message,
      actions: typeof options === "string" ? [options, ...actions] : actions,
    }),
  showInputBox: (options: any) =>
    request("input", { ...options, validateInput: undefined }),
  showQuickPick: async (items: any, options: any) => {
    const values = await items;
    const index = await request("pick", {
      items: values.map((i: any) =>
        typeof i === "string"
          ? { label: i }
          : { label: i.label, description: i.description, detail: i.detail },
      ),
      ...options,
    });
    return index === undefined ? undefined : values[index];
  },
  showOpenDialog: async (options: any) => {
    const result = await request("open-file", {
      ...options,
      defaultUri: options.defaultUri?.fsPath,
    });
    if (!result?.uploads) return result?.map((p: string) => Uri.file(p));
    const dir = transferDir();
    await mkdir(dir, { recursive: true });
    return Promise.all(
      result.uploads.map(async (file: { name: string; data: string }) => {
        const path = join(dir, basename(file.name));
        await writeFile(path, Buffer.from(file.data, "base64"));
        return Uri.file(path);
      }),
    );
  },
  showSaveDialog: async (options: any) => {
    const result = await request("save-file", {
      ...options,
      defaultUri: options.defaultUri?.fsPath,
    });
    if (!result?.download) return result ? Uri.file(result) : undefined;
    const path = join(
      transferDir(),
      basename(
        options.defaultUri?.fsPath ||
          `export.${Object.values<string[]>(options.filters ?? {})[0]?.[0] ?? "txt"}`,
      ),
    );
    downloads.add(path);
    return Uri.file(path);
  },
  showTextDocument: async (doc: any) => {
    let editor = window.visibleTextEditors.find((e: any) => e.document === doc);
    if (!editor) {
      editor = {
        document: doc,
        selection: new Selection(new Position(0, 0), new Position(0, 0)),
      };
      window.visibleTextEditors.push(editor);
    }
    window.activeTextEditor = editor;
    activeEditorChanged.fire(editor);
    emit({
      type: "editor",
      id: doc.uri.toString(),
      text: doc.content,
      language: doc.languageId,
    });
    return editor;
  },
  createQuickPick: () => {
    const id = `picker-${++requestId}`;
    const accepted = new EventEmitter();
    const hidden = new EventEmitter();
    const valueChanged = new EventEmitter();
    const selectionChanged = new EventEmitter();
    let items: any[] = [];
    const picker: any = {
      id,
      selectedItems: [],
      activeItems: [],
      value: "",
      busy: false,
      onDidAccept: accepted.event,
      onDidHide: hidden.event,
      onDidChangeValue: valueChanged.event,
      onDidChangeSelection: selectionChanged.event,
      get items() {
        return items;
      },
      set items(value: any[]) {
        items = value;
        emit({
          type: "picker-items",
          id,
          items: value.map(({ label, description, detail }) => ({
            label,
            description,
            detail,
          })),
        });
      },
      show: () =>
        emit({
          type: "picker",
          id,
          placeholder: picker.placeholder,
          items: items.map(({ label, description, detail }) => ({
            label,
            description,
            detail,
          })),
        }),
      hide: () => {
        emit({ type: "picker-close", id });
        hidden.fire();
      },
      dispose() {},
      accept: (index: number) => {
        picker.selectedItems = [items[index]];
        picker.activeItems = [items[index]];
        selectionChanged.fire(picker.selectedItems);
        accepted.fire();
      },
      change: (value: string) => {
        picker.value = value;
        valueChanged.fire(value);
      },
    };
    pickers.set(id, picker);
    return picker;
  },
  createTerminal: (options: any) => {
    const id = `terminal-${++panelSeq}`;
    const term: any = {
      show: () => emit({ type: "terminal", id, title: options.name }),
      dispose: () => {
        options.pty?.close();
        term.process?.kill();
        emit({ type: "terminal-close", id });
      },
      input: (value: string) =>
        options.pty
          ? options.pty.handleInput(value)
          : term.process?.write(value),
    };
    terminals.set(id, term);
    if (options.pty) {
      options.pty.onDidWrite((text: string) =>
        emit({ type: "terminal-output", id, text }),
      );
      options.pty.open();
    } else {
      term.process = pty.spawn(options.shellPath, options.shellArgs ?? [], {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        env: { ...process.env, ...options.env } as Record<string, string>,
      });
      term.process.onData((text: string) =>
        emit({ type: "terminal-output", id, text }),
      );
    }
    return term;
  },
};
const pickers = new Map<string, any>();
export async function dispatch(method: string, params: any) {
  if (method === "editor-completions" || method === "editor-lenses") {
    const doc = documents.get(params.id);
    if (!doc) return [];
    if (method === "editor-lenses")
      return (
        await Promise.all(
          [...lensProviders].map((provider) => provider.provideCodeLenses(doc)),
        )
      ).flat();
    if (doc.languageId !== "sql") return [];
    return (
      await Promise.all(
        [...completionProviders].map((provider) =>
          provider.provideCompletionItems(
            doc,
            new Position(params.line, params.character),
          ),
        ),
      )
    ).flat();
  }
  if (method === "snapshot") return structuredClone(state);
  if (method === "restore") {
    for (const saved of savedDocuments)
      await window.showTextDocument(
        document(saved.text, saved.language, Uri.parse(saved.id)),
      );
    return;
  }
  if (method === "command") {
    if (params.node) tree.selection = [params.node];
    return commands.executeCommand(params.command, ...(params.args ?? []));
  }
  if (method === "tree") {
    const nodes = await tree.provider.getChildren(params.node);
    return nodes.map((node: any) => {
      const item = tree.provider.getTreeItem(node);
      return {
        node,
        id: node.kind === "connection" ? item.id.slice(0, -2) : item.id,
        collapsible: item.collapsibleState !== 0,
        expanded: item.collapsibleState === 2,
        context: item.contextValue,
        command: item.command,
        icon:
          item.iconPath instanceof Uri
            ? `/extension/${relative(workerData.extensionPath, item.iconPath.fsPath).split("\\").join("/")}`
            : undefined,
      };
    });
  }
  if (method === "panel-message") {
    panels.get(params.id)?.receive(params.message);
    return;
  }
  if (method === "panel-ready") {
    panels.get(params.id)?.ready();
    return;
  }
  if (method === "panel-close") {
    panels.get(params.id)?.dispose();
    return;
  }
  if (method === "respond") {
    const pending = requests.get(params.id);
    requests.delete(params.id);
    if (params.error) pending?.reject(new Error(params.error));
    else pending?.resolve(params.value);
    return;
  }
  if (method === "picker-change") {
    pickers.get(params.id)?.change(params.value);
    return;
  }
  if (method === "picker-accept") {
    pickers.get(params.id)?.accept(params.index);
    return;
  }
  if (method === "picker-close") {
    pickers.get(params.id)?.hide();
    return;
  }
  if (method === "editor-change") {
    const doc = documents.get(params.id);
    if (!doc) throw new Error("Editor is closed");
    doc.content = params.text;
    const editor = window.visibleTextEditors.find(
      (e: any) => e.document === doc,
    );
    editor.selection = new Selection(
      doc.positionAt(params.start),
      doc.positionAt(params.end),
    );
    window.activeTextEditor = editor;
    activeEditorChanged.fire(editor);
    saveDocuments();
    return;
  }
  if (method === "editor-close") {
    const doc = documents.get(params.id);
    if (doc) {
      documents.delete(params.id);
      window.visibleTextEditors = window.visibleTextEditors.filter(
        (editor: any) => editor.document !== doc,
      );
      documentClosed.fire(doc);
      saveDocuments();
    }
    return;
  }
  if (method === "terminal-input") {
    terminals.get(params.id)?.input(params.text);
    return;
  }
  if (method === "terminal-close") {
    terminals.get(params.id)?.dispose();
    terminals.delete(params.id);
    return;
  }
  if (method === "dispose") {
    for (const t of terminals.values()) t.dispose();
    for (const d of context.subscriptions) d.dispose();
    return;
  }
  throw new Error("Unknown browser host operation");
}
