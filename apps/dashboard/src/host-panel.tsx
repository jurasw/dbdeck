import { memo, useEffect, useRef } from "react";
import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/codelens/register";
import "monaco-editor/features/suggest/register";
import "monaco-editor/features/find/register";
import "monaco-editor/features/clipboard/register";
import "monaco-editor/features/contextmenu/register";
import "monaco-editor/features/bracketMatching/register";
import "monaco-editor/features/folding/register";
import "monaco-editor/languages/definitions/sql/register";
import "monaco-editor/languages/definitions/javascript/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button } from "../../extension/webview/ui/components/ui/button";
import { Play, Download } from "lucide-react";

(globalThis as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };
monaco.editor.defineTheme("dbdeck", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#171922",
    "editor.foreground": "#f4f5f8",
    "editorLineNumber.foreground": "#636e84",
    "editor.selectionBackground": "#314568",
    "editor.lineHighlightBackground": "#1d202a",
  },
});

export const HostPanel = memo(function HostPanel({
  panel,
  visible,
  onReady,
  register,
}: {
  panel: any;
  visible: boolean;
  onReady: (id: string) => void;
  register: (id: string, frame: HTMLIFrameElement | null) => void;
}) {
  return (
    <iframe
      className={`extension-frame ${visible ? "" : "hidden-panel"}`}
      title={panel.title}
      srcDoc={panel.html}
      ref={(frame) => register(panel.id, frame)}
      sandbox="allow-scripts allow-same-origin allow-downloads"
      onLoad={() => onReady(panel.id)}
    />
  );
});

export function QueryEditor({
  document,
  visible,
  rpc,
  run,
}: {
  document: any;
  visible: boolean;
  rpc: (method: string, params: any) => Promise<any>;
  run: (command: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const actions = useRef({ rpc, run });
  actions.current = { rpc, run };
  useEffect(() => {
    const language =
      document.language === "dbdeck-es" ? "plaintext" : document.language;
    const instance = monaco.editor.create(container.current!, {
      value: document.text,
      language,
      theme: "dbdeck",
      automaticLayout: true,
      fontSize: 13,
      fontFamily: "'SFMono-Regular', Consolas, monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 18 },
      tabSize: 2,
    });
    editor.current = instance;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      const model = instance.getModel();
      const selection = instance.getSelection();
      if (model && selection)
        await actions.current.rpc("editor-change", {
          id: document.id,
          text: model.getValue(),
          start: model.getOffsetAt(selection.getStartPosition()),
          end: model.getOffsetAt(selection.getEndPosition()),
        });
    };
    const execute = async (command: string) => {
      clearTimeout(timer);
      await sync();
      actions.current.run(command);
    };
    const lensesChanged =
      new monaco.Emitter<monaco.languages.CodeLensProvider>();
    const invalidateLenses = () => lensesChanged.fire(lenses);
    window.addEventListener("dbdeck-editor-services", invalidateLenses);
    const completionProvider = monaco.languages.registerCompletionItemProvider(
      "sql",
      {
        triggerCharacters: ["."],
        provideCompletionItems: async (model, position) => {
          if (model !== instance.getModel()) return { suggestions: [] };
          try {
            await sync();
            const items = await actions.current.rpc("editor-completions", {
              id: document.id,
              line: position.lineNumber - 1,
              character: position.column - 1,
            });
            const word = model.getWordUntilPosition(position);
            return {
              suggestions: items.map((item: any) => ({
                label: item.label,
                insertText: item.label,
                detail: item.detail,
                kind:
                  item.kind === 7
                    ? monaco.languages.CompletionItemKind.Class
                    : item.kind === 5
                      ? monaco.languages.CompletionItemKind.Field
                      : monaco.languages.CompletionItemKind.Keyword,
                range: new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn,
                ),
              })),
            };
          } catch {
            return { suggestions: [] };
          }
        },
      },
    );
    const lensActionId = `dbdeck.lens.${document.id}`;
    const lensAction = instance.addAction({
      id: lensActionId,
      label: "Run DBDeck statement",
      run: async (_editor, command: any) => {
        await sync();
        await actions.current.rpc("command", {
          command: command.command,
          args: command.arguments || [],
        });
      },
    });
    const lenses: monaco.languages.CodeLensProvider = {
      onDidChange: lensesChanged.event,
      provideCodeLenses: async (model) => {
        if (model !== instance.getModel()) return { lenses: [], dispose() {} };
        try {
          await sync();
          const items = await actions.current.rpc("editor-lenses", {
            id: document.id,
          });
          return {
            lenses: items.map((item: any, index: number) => ({
              id: String(index),
              range: new monaco.Range(
                item.range.start.line + 1,
                item.range.start.character + 1,
                item.range.end.line + 1,
                item.range.end.character + 1,
              ),
              command: {
                id: lensActionId,
                title: item.command.title.replace(/\$\([^)]+\)\s*/g, ""),
                arguments: [item.command],
              },
            })),
            dispose() {},
          };
        } catch {
          return { lenses: [], dispose() {} };
        }
      },
    };
    const lensProvider = monaco.languages.registerCodeLensProvider(
      language,
      lenses,
    );
    instance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => void execute("dbdeck.runQuery"),
    );
    instance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => void execute("dbdeck.runAll"),
    );
    const changed = instance.onDidChangeModelContent(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void sync(), 200);
      invalidateLenses();
    });
    const focused = instance.onDidFocusEditorText(() => void sync());
    const flush = (event: Event) =>
      (event as CustomEvent<Promise<unknown>[]>).detail.push(sync());
    window.addEventListener("dbdeck-flush", flush);
    (instance as any).dbdeckSync = sync;
    return () => {
      clearTimeout(timer);
      window.removeEventListener("dbdeck-flush", flush);
      window.removeEventListener("dbdeck-editor-services", invalidateLenses);
      completionProvider.dispose();
      lensProvider.dispose();
      lensAction.dispose();
      lensesChanged.dispose();
      changed.dispose();
      focused.dispose();
      instance.getModel()?.dispose();
      instance.dispose();
    };
  }, [document.id]);
  useEffect(() => {
    if (visible) {
      editor.current?.layout();
      editor.current?.focus();
    }
  }, [visible]);
  const execute = async (command: string) => {
    await (editor.current as any)?.dbdeckSync();
    run(command);
  };
  return (
    <div className={`query-wrap ${visible ? "" : "hidden-panel"}`}>
      <div className="query-toolbar">
        <Button size="sm" onClick={() => void execute("dbdeck.runQuery")}>
          <Play />
          Run
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void execute("dbdeck.runAll")}
        >
          Run all
        </Button>
        <span className="text-xs text-muted-foreground">⌘ / Ctrl + Enter</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([editor.current?.getValue() ?? ""], {
                type: "text/plain",
              }),
            );
            const link = window.document.createElement("a");
            link.href = url;
            link.download =
              document.language === "dbdeck-es" ? "query.esreq" : "query.sql";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download />
          Save query
        </Button>
      </div>
      <div ref={container} className="query-editor" />
    </div>
  );
}

export function HostTerminal({
  id,
  initial,
  visible,
  rpc,
  register,
}: {
  id: string;
  initial: string;
  visible: boolean;
  rpc: (method: string, params: any) => Promise<any>;
  register: (id: string, terminal: Terminal | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const terminal = new Terminal({
      theme: { background: "#171922", foreground: "#f4f5f8" },
      fontSize: 13,
      cursorBlink: true,
    });
    terminal.open(container.current!);
    terminal.write(initial);
    register(id, terminal);
    const input = terminal.onData(
      (text) => void rpc("terminal-input", { id, text }),
    );
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height)
        terminal.resize(
          Math.max(10, Math.floor((width - 20) / 8)),
          Math.max(3, Math.floor((height - 20) / 17)),
        );
    });
    resize.observe(container.current!);
    return () => {
      resize.disconnect();
      input.dispose();
      register(id, null);
      terminal.dispose();
    };
  }, [id]);
  return (
    <div
      ref={container}
      className={`terminal-wrap ${visible ? "" : "hidden-panel"}`}
    />
  );
}
