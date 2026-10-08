import {
  btn,
  clear,
  h,
  INIT,
  onMessage,
  rpc,
  toast,
} from "../../extension/webview/lib";
import type { DbNode } from "../../extension/src/types";

const app = document.getElementById("app")!;
const action = async (method: string, params?: unknown) => {
  try {
    return await rpc(method, params);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  }
};

if (INIT.screen === "prompt") {
  const input = h("input", {
    type: INIT.password ? "password" : "text",
    value: INIT.value ?? "",
    placeholder: INIT.placeHolder ?? "",
    autofocus: true,
  });
  const select = h(
    "select",
    {},
    ...(INIT.items ?? []).map(
      (item: string | { label: string }, index: number) =>
        h(
          "option",
          { value: index },
          typeof item === "string" ? item : item.label,
        ),
    ),
  );
  const form = h(
    "form.prompt",
    {
      onSubmit: (event: Event) => {
        event.preventDefault();
        void action("accept", {
          value: INIT.mode === "pick" ? Number(select.value) : input.value,
        });
      },
    },
    h("h1", {}, INIT.title ?? "DBDeck Demo"),
    h("p", {}, INIT.prompt ?? INIT.placeHolder ?? ""),
    INIT.mode === "pick" ? select : input,
    h("button.btn.primary", { type: "submit" }, "Continue"),
  );
  app.append(form);
  input.focus();
} else if (INIT.screen === "document") {
  app.append(h("pre.document", {}, INIT.content));
} else if (INIT.screen === "query") {
  const input = h("textarea.query-editor", {
    spellcheck: false,
    "aria-label": "Query",
    value: INIT.content ?? "",
  });
  const status = h(
    "span",
    {},
    INIT.readonly ? "Read-only connection" : "Queries run on your database",
  );
  const run = btn("Run query", { icon: "play", class: "primary" });
  const execute = async () => {
    run.disabled = true;
    status.textContent = "Running…";
    await action("run", { text: input.value });
    run.disabled = false;
    status.textContent = "Results open in the Query Results window";
  };
  run.addEventListener("click", () => {
    void execute();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!run.disabled) void execute();
    }
  });
  app.append(
    h("div.query-toolbar", {}, h("strong", {}, INIT.location), run),
    input,
    h(
      "div.query-status",
      {},
      status,
      h("span", {}, "⌘ Enter to run · Desktop demo"),
    ),
  );
} else {
  const tree = h("div.connection-tree", {
    role: "tree",
    "aria-label": "Connections",
  });
  const welcome = h(
    "section.welcome",
    {},
    h("img.welcome-icon", {
      src: INIT.brandIcon,
      alt: "",
      width: 72,
      height: 72,
    }),
    h("span.demo-badge", {}, "macOS demo"),
    h("h1", {}, "Your databases.\nIn their own window."),
    h(
      "p",
      {},
      "Open Demo shop to browse sample orders, run a query or explore the schema. Add a connection to work with your own database.",
    ),
    h(
      "div.welcome-actions",
      {},
      btn("Add connection", {
        icon: "add",
        class: "primary",
        onClick: () => {
          void action("add");
        },
      }),
      btn("Try a query", {
        icon: "play",
        onClick: () => {
          void action("query", {
            node: {
              connId: "desktop-demo-shop",
              kind: "connection",
              label: "Demo shop",
            },
          });
        },
      }),
    ),
    h(
      "div.demo-details",
      {},
      h("strong", {}, "One DBDeck, two ways to use it"),
      h(
        "p",
        {},
        "The same connection form, drivers, data grid and schema diagrams as the editor extension.",
      ),
      h(
        "p",
        {},
        "Early desktop demo. AI, MCP, editor completions, storage file actions and Docker controls are available in the extension.",
      ),
    ),
  );
  const sidebar = h(
    "aside.sidebar",
    {},
    h(
      "div.sidebar-title",
      {},
      h("img.brand-icon", {
        src: INIT.brandIcon,
        alt: "",
        width: 28,
        height: 28,
      }),
      h("strong", {}, "DBDeck"),
      h("span.demo-badge", {}, "Demo"),
    ),
    h(
      "div.sidebar-tools",
      {},
      h("span", {}, "Connections"),
      btn(null, {
        icon: "add",
        title: "Add connection",
        onClick: () => {
          void action("add");
        },
      }),
      btn(null, {
        icon: "refresh",
        title: "Refresh",
        onClick: () => {
          void load();
        },
      }),
    ),
    tree,
  );
  app.append(h("div.desktop-layout", {}, sidebar, welcome));
  const expanded = new Set<string>();
  const id = (node: DbNode) =>
    JSON.stringify([
      node.connId,
      node.kind,
      node.database,
      node.schema,
      node.table,
      node.key,
      node.prefix,
      node.label,
    ]);
  const branch = async (parent?: DbNode): Promise<HTMLElement[]> => {
    const nodes = await rpc<DbNode[]>("children", { node: parent });
    return Promise.all(
      nodes.map(async (node) => {
        const key = id(node);
        const children = h("div.tree-children");
        const label = btn(node.label, {
          class: "tree-label",
          title: node.tooltip ?? node.label,
        });
        const expandable =
          !node.leaf &&
          ![
            "table",
            "view",
            "collection",
            "esIndex",
            "redisKey",
            "s3Object",
            "routine",
            "column",
            "info",
            "error",
            "esField",
          ].includes(node.kind);
        const toggle = btn(null, {
          icon: expanded.has(key) ? "chevron-down" : "chevron-right",
          title: `Expand ${node.label}`,
          class: expandable ? "tree-toggle" : "tree-toggle invisible",
        });
        const expand = async () => {
          toggle.disabled = true;
          try {
            if (expanded.has(key)) {
              expanded.delete(key);
              clear(children);
            } else {
              expanded.add(key);
              clear(children, await branch(node));
            }
            toggle.replaceChildren(
              h("i", {
                class: `codicon codicon-${expanded.has(key) ? "chevron-down" : "chevron-right"}`,
              }),
            );
          } catch (error) {
            expanded.delete(key);
            toast(String(error), "error");
          } finally {
            toggle.disabled = false;
          }
        };
        toggle.addEventListener("click", () => {
          void expand();
        });
        label.addEventListener("click", () => {
          if (expandable) void expand();
          else if (
            ["table", "view", "collection", "esIndex", "redisKey"].includes(
              node.kind,
            )
          )
            void action("open", { node });
        });
        const tools = h("div.node-tools");
        if (
          [
            "connection",
            "database",
            "schema",
            "table",
            "view",
            "collection",
            "esIndex",
          ].includes(node.kind)
        )
          tools.append(
            btn(null, {
              icon: "play",
              title: `Query ${node.label}`,
              onClick: () => {
                void action("query", { node });
              },
            }),
          );
        if (["database", "schema"].includes(node.kind))
          tools.append(
            btn(null, {
              icon: "type-hierarchy",
              title: `Diagram ${node.label}`,
              onClick: () => {
                void action("diagram", { node });
              },
            }),
          );
        if (node.kind === "connection")
          tools.append(
            btn(null, {
              icon: "edit",
              title: `Edit ${node.label}`,
              onClick: () => {
                expanded.delete(key);
                void action("edit", { node });
              },
            }),
            btn(null, {
              icon: "debug-disconnect",
              title: `Disconnect ${node.label}`,
              onClick: () => {
                expanded.delete(key);
                void action("disconnect", { node });
              },
            }),
            btn(null, {
              icon: "trash",
              title: `Delete ${node.label}`,
              onClick: () => {
                void action("remove", { node });
              },
            }),
          );
        if (expanded.has(key)) clear(children, await branch(node));
        return h(
          "div.tree-branch",
          {},
          h("div.tree-row", { role: "treeitem" }, toggle, label, tools),
          children,
        );
      }),
    );
  };
  let loading = false;
  let reload = false;
  async function load() {
    if (loading) {
      reload = true;
      return;
    }
    loading = true;
    try {
      clear(tree, await branch());
    } catch (error) {
      toast(String(error), "error");
    } finally {
      loading = false;
      if (reload) {
        reload = false;
        void load();
      }
    }
  }
  onMessage("refresh", () => {
    void load();
  });
  void load();
}
