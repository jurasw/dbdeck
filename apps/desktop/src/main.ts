import { app, Menu, protocol, safeStorage } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type * as vscode from "vscode";
import {
  ConnectionManager,
  ConnectionStore,
} from "../../extension/src/connections";
import { ConnectionTree } from "../../extension/src/tree";
import { ConnectionPanel } from "../../extension/src/panels/connectionPanel";
import { DataPanel } from "../../extension/src/panels/dataPanel";
import { SchemaPanel } from "../../extension/src/panels/schema-panel";
import { RedisPanel } from "../../extension/src/panels/redisPanel";
import { ResultsView } from "../../extension/src/panels/resultsView";
import { bindRpc, webviewHtml } from "../../extension/src/webviewHost";
import { DbNode, FAMILY } from "../../extension/src/types";
import { SqlDriver } from "../../extension/src/drivers/sql";
import { MongoDriver } from "../../extension/src/drivers/mongo";
import { createDemoDatabase } from "./demo";
import { runQuery } from "./query";
import { DesktopStorage } from "./storage";
import {
  commands,
  configureDialogs,
  DesktopPanel,
  initializeHost,
  Uri,
} from "./vscode-host";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "dbdeck",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
if (process.env.DBDECK_SMOKE_DATA)
  app.setPath("userData", process.env.DBDECK_SMOKE_DATA);
app.setName("DBDeck Demo");
let manager: ConnectionManager;
let root: DesktopPanel | undefined;
const sharedUri = Uri.file(join(__dirname, "shared")) as unknown as vscode.Uri;

function sharedPanel(panel: DesktopPanel): vscode.WebviewPanel {
  return panel as unknown as vscode.WebviewPanel;
}
function desktopPanel(title: string, init: unknown): DesktopPanel {
  const panel = new DesktopPanel("dbdeck.desktop", title);
  panel.webview.html = webviewHtml(
    sharedPanel(panel).webview,
    sharedUri,
    "desktop",
    title,
    {
      ...(init as object),
      brandIcon: panel.webview
        .asWebviewUri(Uri.joinPath(sharedUri, "media", "icon.png"))
        .toString(),
    },
    ["codicon.css", "style.css", "desktop.css"],
  );
  return panel;
}

async function start(): Promise<void> {
  initializeHost(sharedUri.fsPath);
  configureDialogs(
    (options) =>
      new Promise((resolve) => {
        // validateInput is a host callback, never serialize it into the renderer.
        const { validateInput: _validate, ...init } = options;
        const panel = desktopPanel(String(options.title ?? "DBDeck Demo"), {
          ...init,
          screen: "prompt",
        });
        bindRpc(sharedPanel(panel).webview, {
          accept: ({ value }: { value: unknown }) => {
            resolve(value);
            panel.dispose();
          },
        });
        panel.onDidDispose(() => resolve(undefined));
      }),
    async (doc) => {
      desktopPanel("Document", { screen: "document", content: doc.content });
    },
  );
  const directory = app.getPath("userData");
  mkdirSync(directory, { recursive: true });
  const storage = new DesktopStorage(
    join(directory, "connections.json"),
    safeStorage,
  );
  const context = {
    globalState: storage.globalState,
    secrets: storage.secrets,
  } as unknown as vscode.ExtensionContext;
  const store = new ConnectionStore(context);
  manager = new ConnectionManager(store);
  const tree = new ConnectionTree(manager, sharedUri);
  if (!store.get("desktop-demo-shop"))
    await store.save({
      id: "desktop-demo-shop",
      name: "Demo shop",
      type: "sqlite",
      database: createDemoDatabase(directory),
      readonly: true,
      savePassword: false,
    });
  const refresh = () => {
    void root?.webview.postMessage({ type: "refresh" });
  };
  const openTable = async (node: DbNode) => {
    if (
      !node ||
      !["table", "view", "collection", "esIndex"].includes(node.kind)
    )
      throw new Error("Select a table or collection.");
    await DataPanel.show(sharedUri, manager, node, refresh);
  };
  commands.registerCommand("dbdeck.openTable", openTable);
  commands.registerCommand("dbdeck.refresh", refresh);
  const showRoot = () => {
    root = desktopPanel("DBDeck Demo", { screen: "home" });
    const current = root;
    bindRpc(sharedPanel(current).webview, {
      children: ({ node }: { node?: DbNode }) => tree.getChildren(node),
      add: () => ConnectionPanel.show(sharedUri, manager, refresh),
      edit: ({ node }: { node: DbNode }) =>
        ConnectionPanel.show(sharedUri, manager, refresh, { id: node.connId }),
      disconnect: async ({ node }: { node: DbNode }) => {
        await manager.disconnect(node.connId);
        store.forget(node.connId);
        refresh();
      },
      remove: async ({ node }: { node: DbNode }) => {
        const { response } = await import("electron").then(({ dialog }) =>
          dialog.showMessageBox({
            message: `Delete connection "${store.get(node.connId)?.name}"?`,
            buttons: ["Cancel", "Delete"],
            cancelId: 0,
            defaultId: 0,
          }),
        );
        if (response !== 1) return;
        await manager.disconnect(node.connId);
        await store.remove(node.connId);
        refresh();
      },
      open: async ({ node }: { node: DbNode }) => {
        if (node.kind === "redisKey")
          return RedisPanel.show(
            sharedUri,
            manager,
            node.connId,
            Number(node.database),
            node.key!,
            refresh,
          );
        return openTable(node);
      },
      diagram: ({ node }: { node: DbNode }) =>
        SchemaPanel.show(sharedUri, manager, node),
      query: async ({ node }: { node: DbNode }) => {
        const config = store.get(node.connId);
        if (!config || !["sql", "mongo", "es"].includes(FAMILY[config.type]))
          throw new Error("Select a SQL, MongoDB or Elasticsearch connection.");
        const driver = await manager.get(node.connId);
        let database = node.database;
        if (
          !database &&
          (driver instanceof SqlDriver || driver instanceof MongoDriver)
        ) {
          const databases = await driver.databases();
          database =
            databases.length === 1
              ? databases[0]
              : ((await import("./vscode-host").then(({ window }) =>
                  window.showQuickPick(databases, { title: "Choose database" }),
                )) as string | undefined);
          if (!database) return;
        }
        const location = [config.name, database, node.schema]
          .filter(Boolean)
          .join(" › ");
        const sample =
          node.table && driver instanceof SqlDriver
            ? driver.selectSql(
                { database, schema: node.schema, table: node.table },
                { limit: 100, offset: 0 },
              )
            : config.id === "desktop-demo-shop"
              ? "SELECT c.name, o.status, o.total\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nORDER BY o.total DESC;"
              : "";
        const editor = desktopPanel(location, {
          screen: "query",
          location,
          content: sample,
          readonly: !!config.readonly,
        });
        let resultsPanel: DesktopPanel | undefined;
        let results: ResultsView | undefined;
        let running = false;
        bindRpc(sharedPanel(editor).webview, {
          run: async ({ text }: { text: string }) => {
            if (running)
              throw new Error("Wait for the current query to finish.");
            running = true;
            try {
              if (!resultsPanel || resultsPanel.browser.isDestroyed()) {
                resultsPanel = new DesktopPanel(
                  "dbdeck.results",
                  "Query Results",
                );
                results = new ResultsView(sharedUri);
                results.resolveWebviewView(
                  sharedPanel(resultsPanel) as unknown as vscode.WebviewView,
                );
              }
              await results!.running(location, text.slice(0, 120));
              await results!.show({
                location,
                results: await runQuery(driver, text, database),
              });
              refresh();
            } finally {
              running = false;
            }
          },
        });
      },
    });
    current.onDidDispose(() => {
      if (root === current) root = undefined;
    });
  };
  showRoot();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "DBDeck Demo",
        submenu: [
          { label: "About DBDeck Demo", click: () => app.showAboutPanel() },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  app.setAboutPanelOptions({
    applicationName: "DBDeck Demo",
    applicationVersion: app.getVersion(),
    credits:
      "macOS demo. Shared drivers and data panels with the DBDeck editor extension.",
    website: "https://dbdeck.dev",
  });
  app.on("activate", () => {
    if (!root) showRoot();
    else root.reveal();
  });
}

app
  .whenReady()
  .then(start)
  .catch((error: unknown) => {
    console.error(error);
    app.quit();
  });
app.on("before-quit", () => manager?.dispose());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
