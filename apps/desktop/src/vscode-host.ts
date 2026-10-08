import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  protocol,
  shell,
} from "electron";
import { readFileSync, promises as fs } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { theme } from "./theme";

export class EventEmitter<T> {
  private listeners = new Set<(value: T) => unknown>();
  event = (listener: (value: T) => unknown) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value: T): void {
    for (const listener of this.listeners) void listener(value);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class Uri {
  constructor(
    readonly fsPath: string,
    private url?: string,
  ) {}
  static file(file: string): Uri {
    return new Uri(resolve(file));
  }
  static parse(url: string): Uri {
    return url.startsWith("file:")
      ? Uri.file(fileURLToPath(url))
      : new Uri("", url);
  }
  static joinPath(uri: Uri, ...parts: string[]): Uri {
    return Uri.file(join(uri.fsPath, ...parts));
  }
  toString(): string {
    return this.url ?? pathToFileURL(this.fsPath).href;
  }
}
export class ThemeIcon {
  constructor(readonly id: string) {}
}
export class ThemeColor {
  constructor(readonly id: string) {}
}
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export class TreeItem {
  id?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  constructor(
    readonly label: string,
    readonly collapsibleState: number,
  ) {}
}
export const ViewColumn = { Active: 1, Beside: 2 };
export const ProgressLocation = { Notification: 15, Window: 10 };

let resourceRoot: string;
let renderPrompt: (options: Record<string, unknown>) => Promise<unknown>;
let renderDocument: (doc: {
  content: string;
  language?: string;
}) => Promise<unknown>;
const panels = new Map<number, DesktopPanel>();
const documents = new Map<string, string>();
const commandHandlers = new Map<string, (...args: any[]) => unknown>();
let documentSequence = 0;

export function initializeHost(root: string): void {
  resourceRoot = resolve(root);
  protocol.handle("dbdeck", (request) => {
    const url = new URL(request.url);
    if (url.host === "panel") {
      const html = documents.get(url.pathname);
      return new Response(html ?? "Not found", {
        status: html ? 200 : 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.host !== "assets")
      return new Response("Not found", { status: 404 });
    const file = resolve(resourceRoot, `.${decodeURIComponent(url.pathname)}`);
    const allowed = ["media", join("dist", "webview")].some((directory) => {
      const path = relative(join(resourceRoot, directory), file);
      return (
        path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep)
      );
    });
    if (!allowed) return new Response("Forbidden", { status: 403 });
    try {
      const mime: Record<string, string> = {
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ttf": "font/ttf",
        ".css": "text/css",
        ".js": "text/javascript",
      };
      return new Response(new Uint8Array(readFileSync(file)), {
        headers: {
          "content-type": mime[extname(file)] ?? "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  ipcMain.on("dbdeck:message", (event, message: unknown) => {
    const panel = panels.get(event.sender.id);
    if (
      !panel ||
      event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame.url.startsWith("dbdeck://panel/")
    )
      return;
    panel.received.fire(message);
  });
}

export function configureDialogs(
  prompt: typeof renderPrompt,
  document: typeof renderDocument,
): void {
  renderPrompt = prompt;
  renderDocument = document;
}

export class DesktopPanel {
  readonly browser: BrowserWindow;
  readonly received = new EventEmitter<unknown>();
  private readonly disposed = new EventEmitter<void>();
  private documentPath = `/document-${++documentSequence}`;
  private html = "";
  private loaded = false;
  private outgoing: unknown[] = [];
  iconPath: unknown;
  readonly webview;
  constructor(
    readonly viewType: string,
    title: string,
  ) {
    this.browser = new BrowserWindow({
      title: `${title} · DBDeck Demo`,
      width: 1180,
      height: 800,
      minWidth: 720,
      minHeight: 480,
      backgroundColor: "#101114",
      show: false,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    panels.set(this.browser.webContents.id, this);
    const contentsId = this.browser.webContents.id;
    this.browser.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.browser.on("page-title-updated", (event, title) => {
      event.preventDefault();
      this.browser.setTitle(`${title} · DBDeck Demo`);
    });
    this.browser.webContents.on("will-navigate", (event) =>
      event.preventDefault(),
    );
    this.browser.webContents.on("did-finish-load", () => {
      this.loaded = true;
      for (const message of this.outgoing.splice(0))
        this.browser.webContents.send("dbdeck:message", message);
      this.browser.show();
    });
    this.browser.on("closed", () => {
      panels.delete(contentsId);
      documents.delete(this.documentPath);
      this.disposed.fire();
      this.disposed.dispose();
      this.received.dispose();
    });
    const panel = this;
    this.webview = {
      options: {},
      cspSource: "dbdeck:",
      get html() {
        return panel.html;
      },
      set html(value: string) {
        panel.html = value;
        panel.loaded = false;
        const nonce = /nonce="([^"]+)"/.exec(value)?.[1];
        if (!nonce)
          throw new Error("Shared webview is missing its script nonce.");
        const bridge = `<style>${theme}</style><script nonce="${nonce}">window.dbdeckMessages.subscribe(message => window.postMessage(message, '*'));</script>`;
        documents.set(
          panel.documentPath,
          value.replace("</head>", `${bridge}</head>`),
        );
        void panel.browser.loadURL(`dbdeck://panel${panel.documentPath}`);
      },
      asWebviewUri(uri: Uri) {
        const path = relative(resourceRoot, uri.fsPath)
          .split(sep)
          .map(encodeURIComponent)
          .join("/");
        return Uri.parse(`dbdeck://assets/${path}`);
      },
      onDidReceiveMessage: panel.received.event,
      async postMessage(message: unknown) {
        if (panel.browser.isDestroyed()) return false;
        if (panel.loaded)
          panel.browser.webContents.send("dbdeck:message", message);
        else panel.outgoing.push(message);
        return true;
      },
    };
  }
  get title(): string {
    return this.browser.getTitle();
  }
  set title(value: string) {
    this.browser.setTitle(`${value} · DBDeck Demo`);
  }
  get visible(): boolean {
    return this.browser.isVisible();
  }
  reveal(): void {
    this.browser.show();
    this.browser.focus();
  }
  show(): void {
    this.reveal();
  }
  onDidDispose = (listener: () => unknown) => this.disposed.event(listener);
  dispose(): void {
    this.browser.close();
  }
}

async function showMessage(
  message: string,
  ...args: unknown[]
): Promise<string | undefined> {
  const actions = args.filter(
    (argument): argument is string => typeof argument === "string",
  );
  const result = await dialog.showMessageBox({
    title: "DBDeck Demo",
    message,
    buttons: [...actions, "Close"],
    cancelId: actions.length,
    defaultId: actions.length,
  });
  return actions[result.response];
}

export const window = {
  createWebviewPanel: (type: string, title: string) =>
    new DesktopPanel(type, title),
  showErrorMessage: showMessage,
  showWarningMessage: showMessage,
  showInformationMessage: showMessage,
  showInputBox: async (options: Record<string, unknown>) => {
    const value = await renderPrompt({ ...options, mode: "input" });
    if (typeof value !== "string") return undefined;
    const validate = options.validateInput as
      ((value: string) => unknown) | undefined;
    const error = validate?.(value);
    if (error) {
      await showMessage(String(error));
      return undefined;
    }
    return value;
  },
  showQuickPick: async (
    items: unknown[],
    options?: Record<string, unknown>,
  ) => {
    const index = await renderPrompt({ ...options, mode: "pick", items });
    return typeof index === "number" ? items[index] : undefined;
  },
  showOpenDialog: async (options: {
    canSelectMany?: boolean;
    defaultUri?: Uri;
    filters?: Record<string, string[]>;
    openLabel?: string;
  }) => {
    const result = await dialog.showOpenDialog({
      properties: options.canSelectMany
        ? ["openFile", "multiSelections"]
        : ["openFile"],
      defaultPath: options.defaultUri?.fsPath,
      buttonLabel: options.openLabel,
      filters: Object.entries(options.filters ?? {}).map(
        ([name, extensions]) => ({ name, extensions }),
      ),
    });
    return result.canceled ? undefined : result.filePaths.map(Uri.file);
  },
  showSaveDialog: async (options: { defaultUri?: Uri; saveLabel?: string }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: options.defaultUri?.fsPath,
      buttonLabel: options.saveLabel,
    });
    return result.canceled || !result.filePath
      ? undefined
      : Uri.file(result.filePath);
  },
  withProgress: async (
    _options: unknown,
    task: (progress: unknown, token: unknown) => Promise<unknown>,
  ) =>
    task(
      { report() {} },
      { onCancellationRequested: () => ({ dispose() {} }) },
    ),
  showTextDocument: async (doc: { content: string; language?: string }) =>
    renderDocument(doc),
  createOutputChannel: () => ({
    info: (...args: unknown[]) => console.info(...args),
    dispose() {},
  }),
};

export const workspace = {
  workspaceFolders: undefined,
  fs: {
    writeFile: async (uri: Uri, data: Uint8Array) =>
      fs.writeFile(uri.fsPath, data),
  },
  getConfiguration: () => ({
    get: <T>(key: string): T | undefined =>
      ({
        pageSize: 100,
        maxResultRows: 5000,
        redisKeySeparator: ":",
        redisScanLimit: 5000,
      })[key] as T | undefined,
  }),
  openTextDocument: async (doc: { content: string; language?: string }) => doc,
};
export const env = {
  clipboard: { writeText: async (text: string) => clipboard.writeText(text) },
  openExternal: async (uri: Uri) => {
    if (!/^https?:\/\//.test(uri.toString()))
      throw new Error("Only HTTP and HTTPS links can open in your browser.");
    await shell.openExternal(uri.toString());
    return true;
  },
};
export const commands = {
  registerCommand: (name: string, handler: (...args: any[]) => unknown) => {
    commandHandlers.set(name, handler);
    return { dispose: () => commandHandlers.delete(name) };
  },
  executeCommand: async (name: string, ...args: unknown[]) => {
    const handler = commandHandlers.get(name);
    if (!handler)
      throw new Error("This feature is available in the editor extension.");
    return handler(...args);
  },
};

export function closePanels(): void {
  for (const panel of [...panels.values()]) panel.dispose();
}
export { app };
