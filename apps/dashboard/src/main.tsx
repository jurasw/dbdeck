import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Database,
  Settings,
  Plus,
  LockKeyhole,
  Fingerprint,
  ShieldCheck,
  Monitor,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  RefreshCw,
  X,
  Search,
  PanelLeft,
  KeyRound,
  Folder,
  FileCode,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import { Button } from "../../extension/webview/ui/components/ui/button";
import { Input } from "../../extension/webview/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../extension/webview/ui/components/ui/select";
import { Connector, pairing, type HostEvent } from "./connector";
import { HostPanel, HostTerminal, QueryEditor } from "./host-panel";
import {
  newKey,
  wrapPhrase,
  unlockPhrase,
  encryptProject,
  decryptProject,
  registerPasskey,
  unlockPasskey,
  listProjects,
  saveProject,
  deleteProject,
} from "./vault.mjs";
import "./styles.css";

type Snapshot = {
  globals: Record<string, any>;
  secrets: Record<string, string>;
  workspace: Record<string, any>;
  config: Record<string, any>;
  meta: { name: string };
  [key: string]: any;
};
const empty = (name: string): Snapshot => ({
  globals: {},
  secrets: {},
  workspace: {},
  config: {},
  meta: { name },
});
const projectName = (record: any) =>
  record.lock
    ? "Protected project"
    : record.data?.meta?.name || "Local project";
const cleanLabel = (label: string) => label.replace(/\$\([^)]+\)\s*/g, "");
const fileData = (file: File) =>
  new Promise<{ name: string; data: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        data: String(reader.result).slice(
          String(reader.result).indexOf(",") + 1,
        ),
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
const legalOrigin = "https://dbdeck.dev";

function Dialog({
  children,
  close,
  className = "",
}: {
  children: React.ReactNode;
  close?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,button,a,select")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && close) close();
      if (event.key === "Tab") {
        const elements = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,select,a[href]",
          ),
        ];
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-overlay">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={`dialog ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

function HostRequest({
  request,
  respond,
}: {
  request: any;
  respond: (value?: any, error?: string) => void;
}) {
  const [value, setValue] = useState(
    request.options.value || request.options.defaultUri || "",
  );
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const options = request.options;
  const browserFile = request.kind.includes("file") && !!options.filters;
  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    if (list.reduce((size, file) => size + file.size, 0) > 10 * 1024 * 1024)
      return setError("Choose files smaller than 10 MB in total.");
    respond({ uploads: await Promise.all(list.map(fileData)) });
  };
  if (request.kind === "clipboard")
    return (
      <Dialog close={() => respond(undefined, "Copy cancelled")}>
        <h2>Copy to clipboard</h2>
        <p>Your browser requires a click to copy this value.</p>
        <div className="dialog-actions">
          <Button
            onClick={() =>
              void navigator.clipboard
                .writeText(options.text)
                .then(() => respond())
                .catch(() => respond(undefined, "Clipboard access was denied."))
            }
          >
            Copy
          </Button>
        </div>
      </Dialog>
    );
  return (
    <Dialog close={() => respond()}>
      <h2>
        {options.title ||
          options.placeHolder ||
          (request.kind === "message"
            ? "Confirm action"
            : request.kind === "pick"
              ? "Choose an option"
              : request.kind === "save-file"
                ? "Save on this computer"
                : request.kind === "open-file"
                  ? "Open a local file"
                  : "Enter a value")}
      </h2>
      <p>
        {options.message ||
          options.prompt ||
          (request.kind.includes("file")
            ? browserFile
              ? `${request.kind === "save-file" ? "Download the file in this browser" : "Choose a file from this browser"} or enter an absolute path on the computer running your local connector.`
              : "Enter an absolute file path on the computer running your local connector."
            : "")}
      </p>
      {error && <p className="text-destructive">{error}</p>}
      {request.kind === "pick" ? (
        <>
          <Input
            autoFocus
            aria-label="Filter options"
            placeholder="Search…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="pick-list">
            {options.items.map(
              (item: any, index: number) =>
                cleanLabel(item.label)
                  .toLowerCase()
                  .includes(filter.toLowerCase()) && (
                  <button key={index} onClick={() => respond(index)}>
                    {cleanLabel(item.label)}
                    {item.description && <small>{item.description}</small>}
                    {item.detail && <small>{item.detail}</small>}
                  </button>
                ),
            )}
          </div>
        </>
      ) : request.kind !== "message" ? (
        <Input
          autoFocus
          aria-label={options.prompt || "Value"}
          type={options.password ? "password" : "text"}
          autoComplete={options.password ? "current-password" : "off"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" &&
            respond(
              request.kind === "open-file"
                ? value.split("\n").filter(Boolean)
                : value,
            )
          }
        />
      ) : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={() => respond()}>
          Cancel
        </Button>
        {browserFile &&
          (request.kind === "save-file" ? (
            <Button
              variant="outline"
              onClick={() => respond({ download: true })}
            >
              Download
            </Button>
          ) : (
            <label className="inline-flex items-center border border-input rounded-md px-3 text-xs cursor-pointer">
              Choose file
              <input
                type="file"
                multiple={!!options.canSelectMany}
                accept={Object.values<string[]>(options.filters)
                  .flat()
                  .map((ext) => `.${ext}`)
                  .join(",")}
                className="sr-only"
                aria-label="Choose file"
                onChange={(event) =>
                  void upload(event.target.files).catch((e) =>
                    setError(String(e?.message ?? e)),
                  )
                }
              />
            </label>
          ))}
        {request.kind === "message"
          ? options.actions.map((action: string) => (
              <Button key={action} onClick={() => respond(action)}>
                {action}
              </Button>
            ))
          : request.kind !== "pick" && (
              <Button
                onClick={() =>
                  respond(
                    request.kind === "open-file"
                      ? value.split("\n").filter(Boolean)
                      : value,
                  )
                }
              >
                Continue
              </Button>
            )}
      </div>
    </Dialog>
  );
}

function matches(when: string = "", context: string = "") {
  // The source manifest uses viewItem comparisons and regexes. Evaluate only
  // those declarative predicates, never code from manifests or database values.
  return when.split(/\s*&&\s*/).every((part) => {
    const regex = part.match(/^viewItem\s*(!~|=~)\s*\/(.*)\/$/);
    if (regex) {
      try {
        return new RegExp(regex[2]).test(context) === (regex[1] === "=~");
      } catch {
        return false;
      }
    }
    const equal = part.match(/^viewItem\s*(==|!=)\s*(.+)$/);
    if (equal) return (context === equal[2]) === (equal[1] === "==");
    if (part.startsWith("view == "))
      return part === "view == dbdeck.connections";
    return part === "" || part === "true";
  });
}

function App() {
  const [projects, setProjects] = useState<any[]>([]);
  const [record, setRecord] = useState<any>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [locked, setLocked] = useState(false);
  const [paired] = useState(pairing);
  const [online, setOnline] = useState(false);
  const [panels, setPanels] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [terminals, setTerminals] = useState<any[]>([]);
  const [active, setActive] = useState("");
  const [roots, setRoots] = useState<any[]>([]);
  const [children, setChildren] = useState<Record<string, any[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<any>(null);
  const [settings, setSettings] = useState(false);
  const [connect, setConnect] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [picker, setPicker] = useState<any>(null);
  const [menu, setMenu] = useState<any>(null);
  const [manifest, setManifest] = useState<any>(null);
  const [notice, setNotice] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [external, setExternal] = useState("");
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [phraseAgain, setPhraseAgain] = useState("");
  const [protectDialog, setProtectDialog] = useState(false);
  const [nameDialog, setNameDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [sidebar, setSidebar] = useState(innerWidth > 480);
  const [accepted, setAccepted] = useState(
    localStorage.getItem("dbdeck.terms.v1") === "accepted",
  );
  const [consent, setConsent] = useState(false);
  const [preferences, setPreferences] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("dbdeck.web.preferences") ||
          '{"idleSeconds":0,"hideOnBlur":false}',
      );
    } catch {
      return { idleSeconds: 0, hideOnBlur: false };
    }
  });
  const recordRef = useRef<any>(null),
    dataRef = useRef<Snapshot | null>(null),
    keyRef = useRef<CryptoKey | null>(null);
  const engine = useRef<Connector | null>(null),
    eventHandler = useRef<(event: HostEvent) => void>(() => {});
  const frames = useRef(new Map<string, HTMLIFrameElement>()),
    terminalRefs = useRef(new Map<string, any>()),
    terminalText = useRef(new Map<string, string>());
  const writes = useRef(Promise.resolve()),
    lockedRef = useRef(false),
    epoch = useRef(0),
    locking = useRef(false),
    connectionsFile = useRef<File | null>(null);
  const notify = useCallback((message: string, error = false) => {
    setNotice({ message, error });
  }, []);
  const fail = useCallback(
    (error: any) => notify(error?.message || String(error), true),
    [notify],
  );
  const rpc = useCallback(async (method: string, params: any = {}) => {
    if (
      !engine.current ||
      (lockedRef.current && !(locking.current && method === "editor-change"))
    )
      throw new Error(
        "Open an unlocked project and pair your local connector first.",
      );
    return engine.current.rpc(method, params);
  }, []);
  const upsert = (saved: any) => {
    recordRef.current = saved;
    setRecord(saved);
    setProjects((items) => [...items.filter((p) => p.id !== saved.id), saved]);
  };
  const persist = (snapshot: Snapshot, name?: string) => {
    if (lockedRef.current || !recordRef.current) return Promise.resolve();
    const captured = recordRef.current,
      capturedKey = keyRef.current,
      generation = epoch.current;
    const next = {
      ...snapshot,
      meta:
        name !== undefined
          ? { name }
          : dataRef.current?.meta || snapshot.meta || { name: "Local project" },
    };
    dataRef.current = next;
    setData(next);
    const job = writes.current.then(async () => {
      const current =
        generation === epoch.current ? recordRef.current : captured;
      const key = generation === epoch.current ? keyRef.current : capturedKey;
      const saved = current.lock
        ? await encryptProject(current, key, next)
        : { ...current, data: next, updatedAt: Date.now() };
      await saveProject(saved);
      if (generation === epoch.current) upsert(saved);
    });
    writes.current = job.catch(fail);
    return job;
  };
  const clearWorkspace = () => {
    setPanels([]);
    setDocuments([]);
    setTerminals([]);
    setRoots([]);
    setChildren({});
    setExpanded(new Set());
    setActive("");
    setSelected(null);
    setRequests([]);
    setPicker(null);
    setMenu(null);
    frames.current.clear();
    terminalRefs.current.clear();
    terminalText.current.clear();
    setOnline(false);
  };
  const refresh = async () => {
    const generation = epoch.current;
    const nodes = await rpc("tree");
    if (generation !== epoch.current) return;
    setRoots(nodes);
    // Existing expanded branches are refreshed by their original provider.
    for (const id of expanded) {
      const row = [...roots, ...Object.values(children).flat()].find(
        (r) => r.id === id,
      );
      if (row) {
        const items = await rpc("tree", { node: row.node });
        if (generation === epoch.current)
          setChildren((old) => ({ ...old, [id]: items }));
      }
    }
  };
  eventHandler.current = (event) => {
    if (lockedRef.current) return;
    if (event.type === "snapshot") void persist(event.snapshot).catch(fail);
    else if (event.type === "tree-changed") void refresh().catch(fail);
    else if (event.type === "panel-html") {
      setPanels((items) => [...items.filter((p) => p.id !== event.id), event]);
      if (event.viewType !== "dbdeck.results") setActive(event.id);
    } else if (event.type === "panel-message")
      frames.current
        .get(event.id)
        ?.contentWindow?.postMessage(event.message, location.origin);
    else if (event.type === "panel-close") {
      setPanels((items) => items.filter((p) => p.id !== event.id));
      setActive((old) => (old === event.id ? "" : old));
    } else if (
      event.type === "panel-reveal" &&
      !panels.find((p) => p.id === event.id && p.viewType === "dbdeck.results")
    )
      setActive(event.id);
    else if (event.type === "editor") {
      setDocuments((items) => [
        ...items.filter((d) => d.id !== event.id),
        event,
      ]);
      setActive(event.id);
    } else if (event.type === "terminal") {
      setTerminals((items) => [
        ...items.filter((t) => t.id !== event.id),
        event,
      ]);
      setActive(event.id);
    } else if (event.type === "terminal-output") {
      terminalText.current.set(
        event.id,
        ((terminalText.current.get(event.id) || "") + event.text).slice(
          -1000000,
        ),
      );
      terminalRefs.current.get(event.id)?.write(event.text);
    } else if (event.type === "terminal-close")
      setTerminals((items) => items.filter((t) => t.id !== event.id));
    else if (
      event.type === "request" &&
      event.kind === "open-file" &&
      connectionsFile.current
    ) {
      const file = connectionsFile.current;
      connectionsFile.current = null;
      void fileData(file)
        .then((upload) =>
          rpc("respond", { id: event.id, value: { uploads: [upload] } }),
        )
        .catch(fail);
    } else if (event.type === "request")
      setRequests((items) => [...items, event]);
    else if (event.type === "picker") setPicker(event);
    else if (event.type === "picker-items")
      setPicker((old: any) =>
        old?.id === event.id ? { ...old, items: event.items } : old,
      );
    else if (event.type === "picker-close") setPicker(null);
    else if (event.type === "editor-services-changed")
      window.dispatchEvent(new Event("dbdeck-editor-services"));
    else if (event.type === "notice") notify(event.message, !!event.error);
    else if (event.type === "download") {
      const bytes = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes]));
      const a = document.createElement("a");
      a.href = url;
      a.download = event.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (event.type === "external") setExternal(event.url);
  };
  useEffect(() => {
    void fetch("/extension/manifest.json")
      .then((r) => r.json())
      .then(setManifest)
      .catch(fail);
    void listProjects()
      .then(async (items: any[]) => {
        if (!items.length) {
          const initial = {
            id: crypto.randomUUID(),
            data: empty("My project"),
            updatedAt: Date.now(),
          };
          await saveProject(initial);
          items = [initial];
        }
        setProjects(items);
        const selected =
          items.find(
            (p) => p.id === localStorage.getItem("dbdeck.active-project"),
          ) || items[0];
        recordRef.current = selected;
        setRecord(selected);
        lockedRef.current = !!selected.lock;
        setLocked(!!selected.lock);
        if (!selected.lock) {
          dataRef.current = selected.data;
          setData(selected.data);
        }
      })
      .catch(fail);
  }, []);
  useEffect(() => {
    if (!paired) return;
    try {
      engine.current = new Connector(
        paired.url,
        paired.token,
        (event) => eventHandler.current(event),
        (error) => {
          setOnline(false);
          fail(error);
        },
      );
      void engine.current.reset().catch(fail);
    } catch (error) {
      fail(error);
    }
    const exit = () => engine.current?.closeOnExit();
    window.addEventListener("pagehide", exit);
    return () => {
      window.removeEventListener("pagehide", exit);
      void engine.current?.reset().catch(() => {});
    };
  }, [paired]);
  useEffect(() => {
    if (!record?.id || locked || !accepted || !engine.current) return;
    const generation = epoch.current;
    clearWorkspace();
    void engine.current
      .start(dataRef.current)
      .then(() => {
        if (generation === epoch.current && !lockedRef.current) {
          setOnline(true);
          void refresh().catch(fail);
        }
      })
      .catch(fail);
  }, [record?.id, locked, accepted, paired]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        lockedRef.current ||
        event.data?.type !== "dbdeck-webview"
      )
        return;
      const frame = frames.current.get(event.data.panelId);
      if (event.source !== frame?.contentWindow) return;
      if (event.data.activity) {
        window.dispatchEvent(new Event("dbdeck-activity"));
        return;
      }
      void rpc("panel-message", {
        id: event.data.panelId,
        message: event.data.message,
      }).catch(fail);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [rpc]);
  const run = (command: string, node?: any, args?: any[]) => {
    if (!online) {
      setConnect(true);
      return;
    }
    void rpc("command", {
      command,
      node,
      args: args || (node ? [node] : []),
    }).catch(fail);
  };
  const lock = async () => {
    if (lockedRef.current || locking.current || !recordRef.current) return;
    locking.current = true;
    setBusy(true);
    setNotice(null);
    setExternal("");
    setConnect(false);
    setNameDialog(false);
    setDeleteDialog(false);
    setNewName("");
    const capturedData = dataRef.current;
    lockedRef.current = true;
    setLocked(true);
    setData(null);
    setSettings(false);
    setPhrase("");
    setPhraseAgain("");
    setProtectDialog(false);
    clearWorkspace();
    try {
      const pending: Promise<void>[] = [];
      window.dispatchEvent(
        new CustomEvent("dbdeck-flush", { detail: pending }),
      );
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
      let latest = capturedData;
      if (online)
        latest = await Promise.race([
          engine.current!.rpc("snapshot"),
          new Promise<Snapshot | null>((resolve) =>
            setTimeout(() => resolve(capturedData), 1500),
          ),
        ]).catch(() => capturedData);
      await writes.current;
      if (latest) {
        latest = { ...latest, meta: capturedData!.meta };
        // A protection change already in progress must finish before the
        // final write, so locking can never restore an older plaintext record.
        const current = recordRef.current;
        const saved = current.lock
          ? await encryptProject(current, keyRef.current, latest)
          : { ...current, data: latest, updatedAt: Date.now() };
        await saveProject(saved);
        upsert(saved);
      }
    } catch (error) {
      fail(error);
    } finally {
      epoch.current++;
      keyRef.current = null;
      dataRef.current = null;
      await engine.current?.reset().catch(fail);
      locking.current = false;
      setBusy(false);
    }
  };
  const lockRef = useRef(lock);
  lockRef.current = lock;
  useEffect(() => {
    localStorage.setItem("dbdeck.web.preferences", JSON.stringify(preferences));
    let timer: ReturnType<typeof setTimeout>;
    const activity = () => {
      clearTimeout(timer);
      if (
        preferences.idleSeconds > 0 &&
        !lockedRef.current &&
        recordRef.current?.lock
      )
        timer = setTimeout(
          () => void lockRef.current(),
          preferences.idleSeconds * 1000,
        );
    };
    const hidden = () => {
      if (document.hidden && preferences.hideOnBlur && recordRef.current?.lock)
        void lockRef.current();
    };
    for (const event of ["pointerdown", "pointermove", "keydown", "touchstart"])
      window.addEventListener(event, activity, { passive: true });
    window.addEventListener("dbdeck-activity", activity);
    document.addEventListener("visibilitychange", hidden);
    activity();
    return () => {
      clearTimeout(timer);
      for (const event of [
        "pointerdown",
        "pointermove",
        "keydown",
        "touchstart",
      ])
        window.removeEventListener(event, activity);
      window.removeEventListener("dbdeck-activity", activity);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [preferences, locked]);
  const unlock = async (method: "phrase" | "passkey" | "open") => {
    if (busy || locking.current) return;
    setBusy(true);
    setNotice(null);
    try {
      const current = recordRef.current;
      const key =
        method === "phrase"
          ? await unlockPhrase(current, phrase)
          : method === "passkey"
            ? await unlockPasskey(current)
            : null;
      const restored = key ? await decryptProject(current, key) : current.data;
      keyRef.current = key;
      dataRef.current = restored;
      setData(restored);
      lockedRef.current = false;
      setLocked(false);
      setPhrase("");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const selectProject = async (id: string) => {
    if (busy || locking.current) return;
    await writes.current;
    await engine.current?.reset();
    epoch.current++;
    clearWorkspace();
    keyRef.current = null;
    const selected = projects.find((p) => p.id === id);
    if (!selected) return;
    recordRef.current = selected;
    setRecord(selected);
    lockedRef.current = !!selected.lock;
    setLocked(!!selected.lock);
    dataRef.current = selected.lock ? null : selected.data;
    setData(dataRef.current);
    localStorage.setItem("dbdeck.active-project", id);
  };
  const createProject = async () => {
    const project = {
      id: crypto.randomUUID(),
      data: empty(newName.trim() || "My project"),
      updatedAt: Date.now(),
    };
    await writes.current;
    await engine.current?.reset();
    epoch.current++;
    clearWorkspace();
    await saveProject(project);
    upsert(project);
    keyRef.current = null;
    dataRef.current = project.data;
    setData(project.data);
    lockedRef.current = false;
    setLocked(false);
    setNameDialog(false);
    setNewName("");
    localStorage.setItem("dbdeck.active-project", project.id);
  };
  const importProject = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024)
      throw new Error("This project file is too large.");
    const imported = JSON.parse(await file.text());
    if (Array.isArray(imported)) {
      if (!online)
        throw new Error("Connect your local engine to import connections.");
      connectionsFile.current = file;
      setSettings(false);
      run("dbdeck.importConnections");
      return;
    }
    if (
      !imported ||
      typeof imported !== "object" ||
      !(
        (imported.data?.globals &&
          imported.data?.secrets &&
          imported.data?.meta?.name) ||
        (imported.lock &&
          imported.encrypted?.iv &&
          imported.encrypted?.ciphertext)
      )
    )
      throw new Error("Choose a DBDeck project export.");
    const project = {
      ...imported,
      id: crypto.randomUUID(),
      updatedAt: Date.now(),
    };
    await writes.current;
    await engine.current?.reset();
    epoch.current++;
    clearWorkspace();
    await saveProject(project);
    upsert(project);
    keyRef.current = null;
    lockedRef.current = !!project.lock;
    setLocked(!!project.lock);
    dataRef.current = project.lock ? null : project.data;
    setData(dataRef.current);
    setSettings(false);
  };
  const removeProject = async () => {
    await writes.current;
    await engine.current?.reset();
    epoch.current++;
    clearWorkspace();
    await deleteProject(recordRef.current.id);
    let remaining = projects.filter((p) => p.id !== recordRef.current.id);
    if (!remaining.length) {
      const fresh = {
        id: crypto.randomUUID(),
        data: empty("My project"),
        updatedAt: Date.now(),
      };
      await saveProject(fresh);
      remaining = [fresh];
    }
    setProjects(remaining);
    const next = remaining[0];
    recordRef.current = next;
    setRecord(next);
    keyRef.current = null;
    lockedRef.current = !!next.lock;
    setLocked(!!next.lock);
    dataRef.current = next.lock ? null : next.data;
    setData(dataRef.current);
    setDeleteDialog(false);
    setSettings(false);
  };
  const protect = async (method: "phrase" | "passkey") => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (method === "phrase" && phrase !== phraseAgain)
        throw new Error("The phrases do not match.");
      const key = keyRef.current || (await newKey());
      const generation = epoch.current;
      const wrapped =
        method === "phrase"
          ? await wrapPhrase(key, phrase)
          : await registerPasskey(key, dataRef.current!.meta.name);
      if (generation !== epoch.current || lockedRef.current)
        throw new Error(
          "The project was locked before protection was configured.",
        );
      const job = writes.current.then(async () => {
        if (generation !== epoch.current || lockedRef.current)
          throw new Error(
            "The project was locked before protection was configured.",
          );
        keyRef.current = key;
        recordRef.current = {
          ...recordRef.current,
          lock: { ...recordRef.current.lock, [method]: wrapped },
        };
        const saved = await encryptProject(
          recordRef.current,
          key,
          dataRef.current,
        );
        await saveProject(saved);
        upsert(saved);
      });
      writes.current = job.catch(fail);
      await job;
      setProtectDialog(false);
      setPhrase("");
      setPhraseAgain("");
      notify(
        method === "passkey"
          ? "Passkey protection enabled on this browser origin."
          : "This project is encrypted with your phrase.",
      );
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const removeProtection = async () => {
    const job = writes.current.then(async () => {
      const saved = {
        id: recordRef.current.id,
        data: dataRef.current,
        updatedAt: Date.now(),
      };
      recordRef.current = saved;
      keyRef.current = null;
      await saveProject(saved);
      upsert(saved);
    });
    writes.current = job.catch(fail);
    await job;
    notify(
      "Project protection disabled. Local project data is now stored without encryption.",
    );
  };
  const toggleNode = async (row: any, expandOnly = false) => {
    setSelected(row);
    if (row.command && !expandOnly) {
      run(row.command.command, row.node, row.command.arguments);
      if (innerWidth <= 480) setSidebar(false);
      return;
    }
    if (!row.collapsible) return;
    if (expanded.has(row.id)) {
      setExpanded((old) => {
        const next = new Set(old);
        next.delete(row.id);
        return next;
      });
      return;
    }
    const generation = epoch.current;
    const loadBranch = async (item: any, depth = 0) => {
      const values = await rpc("tree", { node: item.node });
      if (generation !== epoch.current || lockedRef.current) return;
      setChildren((old) => ({ ...old, [item.id]: values }));
      setExpanded((old) => new Set(old).add(item.id));
      if (depth < 8)
        for (const child of values)
          if (child.expanded && child.collapsible)
            await loadBranch(child, depth + 1);
    };
    await loadBranch(row);
  };
  const renderTree = (items: any[], depth = 0): React.ReactNode =>
    items.map((row) => (
      <div key={row.id}>
        <div
          className={`tree-row ${selected?.id === row.id ? "selected" : ""}`}
          style={{ paddingLeft: depth * 12 }}
        >
          {row.collapsible ? (
            <button
              className="tree-toggle"
              aria-label={`${expanded.has(row.id) ? "Collapse" : "Expand"} ${row.node.label}`}
              aria-expanded={expanded.has(row.id)}
              onClick={() => void toggleNode(row, true).catch(fail)}
            >
              {expanded.has(row.id) ? <ChevronDown /> : <ChevronRight />}
            </button>
          ) : (
            <span className="tree-toggle-spacer" />
          )}
          <button
            className="tree-label"
            title={row.node.tooltip || row.node.label}
            onClick={() => void toggleNode(row).catch(fail)}
          >
            {row.icon ? (
              <img src={row.icon} alt="" className="tree-icon" />
            ) : row.node.kind.includes("folder") ||
              row.node.kind === "group" ? (
              <Folder />
            ) : (
              <Database />
            )}
            <span className="node-label">{row.node.label}</span>
          </button>
          <Button
            className="node-menu"
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${row.node.label}`}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setMenu({
                row,
                x: Math.min(box.right, innerWidth - 230),
                y: Math.min(box.bottom, innerHeight - 300),
              });
            }}
          >
            <MoreHorizontal />
          </Button>
        </div>
        {expanded.has(row.id) && renderTree(children[row.id] || [], depth + 1)}
      </div>
    ));
  const registerFrame = useCallback(
    (id: string, frame: HTMLIFrameElement | null) => {
      if (frame) frames.current.set(id, frame);
      else frames.current.delete(id);
    },
    [],
  );
  const readyFrame = useCallback(
    (id: string) => {
      void rpc("panel-ready", { id }).catch(fail);
    },
    [rpc],
  );
  const tabs = [
    ...panels.filter((p) => p.viewType !== "dbdeck.results"),
    ...documents.map((d) => ({
      ...d,
      title: d.id.split(":").at(-1),
      editor: true,
    })),
    ...terminals,
  ];
  const results = panels.find((p) => p.viewType === "dbdeck.results");
  const closeTab = (tab: any) => {
    if (tab.html) void rpc("panel-close", { id: tab.id }).catch(fail);
    else if (tab.editor) {
      setDocuments((items) => items.filter((d) => d.id !== tab.id));
      void rpc("editor-close", { id: tab.id }).catch(fail);
    } else {
      setTerminals((items) => items.filter((t) => t.id !== tab.id));
      void rpc("terminal-close", { id: tab.id }).catch(fail);
    }
    setActive((old) => (old === tab.id ? "" : old));
  };
  return (
    <div className="app">
      <header className="app-header">
        <a href={legalOrigin} className="brand">
          <img src="/extension/media/icon.png" alt="" />
          DBDeck
        </a>
        <span className="header-label">Dashboard</span>
        <span className="local-label">
          <i />
          Stored on this device
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle connections"
          onClick={() => setSidebar(!sidebar)}
        >
          <PanelLeft />
        </Button>
        {record?.lock && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide and lock project"
            onClick={() => void lock()}
            disabled={locked}
          >
            <LockKeyhole />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Web settings"
          onClick={() => setSettings(true)}
          disabled={locked}
        >
          <Settings />
        </Button>
      </header>
      <div className="workspace">
        {!locked && (
          <aside className={`sidebar ${sidebar ? "" : "collapsed"}`}>
            <div className="sidebar-top">
              <Select
                value={record?.id || ""}
                onValueChange={(id) => void selectProject(id).catch(fail)}
              >
                <SelectTrigger
                  aria-label="Project"
                  size="sm"
                  className="min-w-0 flex-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.id === record?.id && data
                        ? data.meta.name
                        : projectName(project)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New project"
                onClick={() => setNameDialog(true)}
              >
                <Plus />
              </Button>
            </div>
            <div className="tree-header">
              <span>CONNECTIONS</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Search database values"
                onClick={() => run("dbdeck.omnisearch", selected?.node)}
              >
                <Search />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Add connection"
                onClick={() => run("dbdeck.addConnection")}
              >
                <Plus />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Refresh connections"
                onClick={() => void refresh().catch(fail)}
                disabled={!online}
              >
                <RefreshCw />
              </Button>
            </div>
            <div className="tree">
              {renderTree(roots)}
              {!roots.length && (
                <p className="px-3 text-xs text-muted-foreground leading-6">
                  {online
                    ? "No connections yet. Add your first database."
                    : "Connect your local engine to browse databases."}
                </p>
              )}
            </div>
            <div className="sidebar-bottom">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => run("dbdeck.newQuery", selected?.node)}
              >
                <FileCode />
                New query
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="AI settings"
                onClick={() => run("dbdeck.aiConfigure")}
              >
                <KeyRound />
              </Button>
            </div>
          </aside>
        )}
        {locked ? (
          <div className="lock-screen">
            <div className="lock-card">
              <div className={`lock-mark ${busy ? "busy" : ""}`}>
                {record?.lock?.passkey ? <Fingerprint /> : <LockKeyhole />}
              </div>
              <h1>
                {record?.lock ? "Project locked" : "Your workspace is hidden"}
              </h1>
              <p>
                {record?.lock
                  ? "Unlock the encrypted project on this device. Your databases and credentials stay with you."
                  : "Connections are closed and data is hidden. Continue when you are ready."}
              </p>
              {record?.lock?.passkey && (
                <Button
                  className="passkey-button"
                  disabled={busy}
                  onClick={() => void unlock("passkey")}
                >
                  <Fingerprint />
                  {busy ? "Waiting for your device…" : "Unlock with passkey"}
                </Button>
              )}
              {record?.lock?.phrase && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void unlock("phrase");
                  }}
                >
                  <input
                    hidden
                    autoComplete="username"
                    value={`dbdeck-${record.id}`}
                    readOnly
                  />
                  <Input
                    type="password"
                    aria-label="Project phrase"
                    placeholder="Your project phrase"
                    autoComplete="current-password"
                    value={phrase}
                    onChange={(event) => setPhrase(event.target.value)}
                    disabled={busy}
                  />
                  <Button
                    type="submit"
                    variant={record.lock.passkey ? "outline" : "default"}
                    disabled={busy || !phrase}
                  >
                    Unlock with phrase
                  </Button>
                </form>
              )}
              {!record?.lock && (
                <Button onClick={() => void unlock("open")}>
                  Show workspace
                </Button>
              )}
              <p className="text-xs">
                {record?.lock &&
                  "DBDeck cannot recover a lost phrase or passkey."}
              </p>
              <Select
                value={record?.id || ""}
                onValueChange={(id) => void selectProject(id).catch(fail)}
              >
                <SelectTrigger
                  aria-label="Switch project"
                  className="mb-3 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {projectName(project)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNameDialog(true)}
              >
                New project
              </Button>
            </div>
          </div>
        ) : (
          <main className="editor-area">
            {!!tabs.length && (
              <div className="tabs">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`app-tab ${active === tab.id ? "active" : ""}`}
                  >
                    <button onClick={() => setActive(tab.id)}>
                      {tab.title}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Close ${tab.title}`}
                      onClick={() => closeTab(tab)}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {!active && (
              <div className="welcome">
                <div className="welcome-badge">
                  <ShieldCheck size={12} />
                  YOUR DEVICE. YOUR DATA.
                </div>
                <h1>
                  Your databases.
                  <br />
                  <span>Right here in your browser.</span>
                </h1>
                <p>
                  The DBDeck tools you know, with the same drivers, forms and
                  grids. Projects stay in this browser. A local engine connects
                  to your databases from your computer.
                </p>
                <div className="welcome-actions">
                  <Button
                    onClick={() =>
                      online ? run("dbdeck.addConnection") : setConnect(true)
                    }
                  >
                    <Plus />
                    {online ? "Add connection" : "Connect local engine"}
                  </Button>
                  <Button variant="outline" onClick={() => setSettings(true)}>
                    <Settings />
                    Privacy settings
                  </Button>
                </div>
                <div className="welcome-grid">
                  <div>
                    <Monitor />
                    <strong>Local by default</strong>
                    <p>No DBDeck account or hosted credential storage.</p>
                  </div>
                  <div>
                    <Database />
                    <strong>The same DBDeck</strong>
                    <p>Shared extension code, from connections to queries.</p>
                  </div>
                  <div>
                    <Fingerprint />
                    <strong>Protection you choose</strong>
                    <p>Add a phrase or supported passkey in Settings.</p>
                  </div>
                </div>
              </div>
            )}
            <div className={`panel-content ${active ? "" : "hidden-panel"}`}>
              {panels
                .filter((p) => p.viewType !== "dbdeck.results")
                .map((panel) => (
                  <HostPanel
                    key={panel.id}
                    panel={panel}
                    visible={active === panel.id}
                    register={registerFrame}
                    onReady={readyFrame}
                  />
                ))}
              {documents.map((doc) => (
                <QueryEditor
                  key={doc.id}
                  document={doc}
                  visible={active === doc.id}
                  rpc={rpc}
                  run={run}
                />
              ))}
              {terminals.map((terminal) => (
                <HostTerminal
                  key={terminal.id}
                  id={terminal.id}
                  initial={terminalText.current.get(terminal.id) || ""}
                  visible={active === terminal.id}
                  rpc={rpc}
                  register={(id, instance) => {
                    if (instance) terminalRefs.current.set(id, instance);
                    else terminalRefs.current.delete(id);
                  }}
                />
              ))}
            </div>
            {results && (
              <div className="results-pane">
                <HostPanel
                  panel={results}
                  visible
                  register={registerFrame}
                  onReady={readyFrame}
                />
              </div>
            )}
          </main>
        )}
      </div>
      <footer className="statusbar">
        <span>
          {locked
            ? "Project locked"
            : online
              ? "Local engine connected"
              : "Browser workspace"}
          {manifest?.version && ` · DBDeck ${manifest.version}`}
        </span>
        <span>
          <a href={`${legalOrigin}/terms/`} target="_blank" rel="noreferrer">
            Terms
          </a>{" "}
          ·{" "}
          <a href={`${legalOrigin}/privacy/`} target="_blank" rel="noreferrer">
            Privacy
          </a>
        </span>
      </footer>
      {settings && (
        <Dialog className="settings-dialog" close={() => setSettings(false)}>
          <div className="flex items-center justify-between">
            <h2>Web settings</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close settings"
              onClick={() => setSettings(false)}
            >
              <X />
            </Button>
          </div>
          <p>
            Settings apply to this browser. The desktop add-on keeps its own
            preferences.
          </p>
          <div className="settings-note">
            <ShieldCheck size={18} className="shrink-0" />
            <span>
              Projects are stored locally in IndexedDB. The hosted dashboard
              receives no connections, passwords, queries or results. Without
              protection, this browser stores project data without encryption.
            </span>
          </div>
          <section className="setting-section">
            <h3>Privacy & inactivity</h3>
            {!record?.lock && (
              <p className="text-muted-foreground text-[11px]">
                Set a recovery phrase or passkey to hide this project.
              </p>
            )}
            <div className="setting-row">
              <div>
                Hide data after inactivity
                <p>
                  Closes connections and clears results and unsaved grid edits.
                </p>
              </div>
              <Select
                value={String(preferences.idleSeconds)}
                disabled={!record?.lock}
                onValueChange={(value) =>
                  setPreferences({
                    ...preferences,
                    idleSeconds: Number(value),
                  })
                }
              >
                <SelectTrigger
                  aria-label="Hide data after inactivity"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectItem value="0">Never</SelectItem>
                  <SelectItem value="30">30 seconds</SelectItem>
                  <SelectItem value="60">1 minute</SelectItem>
                  <SelectItem value="300">5 minutes</SelectItem>
                  <SelectItem value="900">15 minutes</SelectItem>
                  <SelectItem value="1800">30 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="setting-row">
              <div>
                Hide when this tab is backgrounded
                <p>Reopen with your phrase or passkey.</p>
              </div>
              <input
                type="checkbox"
                checked={preferences.hideOnBlur}
                disabled={!record?.lock}
                onChange={(event) =>
                  setPreferences({
                    ...preferences,
                    hideOnBlur: event.target.checked,
                  })
                }
              />
            </label>
          </section>
          <section className="setting-section">
            <h3>Project protection</h3>
            <div className="setting-row">
              <div>
                Recovery phrase
                <p>
                  {record?.lock?.phrase
                    ? "Enabled. Your phrase is never stored by DBDeck."
                    : "Optional. Use your browser password manager to remember it."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPhrase("");
                  setPhraseAgain("");
                  setProtectDialog(true);
                }}
              >
                {record?.lock?.phrase ? "Change phrase" : "Set phrase"}
              </Button>
            </div>
            <div className="setting-row">
              <div>
                Passkey
                <p>
                  Touch ID, Windows Hello or another OS verification method.
                  <br />
                  Requires WebAuthn PRF support. Biometrics stay with your
                  device.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void protect("passkey")}
              >
                <Fingerprint />
                {busy
                  ? "Waiting…"
                  : record?.lock?.passkey
                    ? "Replace passkey"
                    : "Add passkey"}
              </Button>
            </div>
            {record?.lock && (
              <div className="flex gap-2 mt-4">
                <Button size="sm" onClick={() => void lock()}>
                  <LockKeyhole />
                  Lock now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void removeProtection().catch(fail)}
                >
                  Disable protection
                </Button>
              </div>
            )}
          </section>
          <section className="setting-section">
            <h3>Connections</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Export this project's connections to a JSON file or import
              connections exported from DBDeck in VS Code or Cursor.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                disabled={!online}
                onClick={() => {
                  setSettings(false);
                  run("dbdeck.exportConnections");
                }}
              >
                Export connections
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!online}
                onClick={() => {
                  setSettings(false);
                  run("dbdeck.importConnections");
                }}
              >
                Import connections
              </Button>
            </div>
          </section>
          <section className="setting-section">
            <h3>Local projects</h3>
            <label className="text-xs text-muted-foreground">
              Project name
              <Input
                aria-label="Current project name"
                className="mt-2 mb-3"
                defaultValue={data?.meta.name}
                onBlur={(event) => {
                  if (dataRef.current)
                    void persist(
                      dataRef.current,
                      event.target.value.trim() || "My project",
                    ).catch(fail);
                }}
              />
            </label>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(recordRef.current)], {
                      type: "application/json",
                    }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "dbdeck-project.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Export project
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNameDialog(true)}
              >
                New project
              </Button>
              <label className="inline-flex items-center border border-input rounded-md px-3 text-xs cursor-pointer">
                Import project
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  aria-label="Import project"
                  onChange={(event) => {
                    void importProject(event.target.files?.[0]).catch(fail);
                    event.target.value = "";
                  }}
                />
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteDialog(true)}
              >
                Delete project
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConnect(true)}
              >
                {online ? "Local engine" : "Connect local engine"}
              </Button>
            </div>
            <p className="text-xs">
              Exports contain credentials. Protected projects remain encrypted
              in their export. Keep a recovery phrase and a backup before
              clearing browser data.
            </p>
          </section>
        </Dialog>
      )}
      {protectDialog && (
        <Dialog close={() => !busy && setProtectDialog(false)}>
          <h2>Encrypt this project</h2>
          <p>
            Choose a long phrase. DBDeck stores a salted key wrapper and
            encrypted data, never your phrase. Your browser password manager may
            remember the phrase for you.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void protect("phrase");
            }}
          >
            <input
              hidden
              autoComplete="username"
              value={`dbdeck-${record.id}`}
              readOnly
            />
            <Input
              className="phrase-input"
              type="password"
              aria-label="New project phrase"
              placeholder="At least 12 characters"
              autoComplete="new-password"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
            />
            <Input
              className="phrase-input"
              type="password"
              aria-label="Repeat project phrase"
              placeholder="Repeat phrase"
              autoComplete="new-password"
              value={phraseAgain}
              onChange={(event) => setPhraseAgain(event.target.value)}
            />
            <div className="dialog-actions">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setProtectDialog(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || phrase.length < 12}>
                {busy ? "Encrypting…" : "Enable protection"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {connect && (
        <Dialog close={() => setConnect(false)}>
          <h2>Your local engine</h2>
          <p>
            The browser cannot open database TCP or SSH connections itself. Run
            the connector on your computer. It executes the same extension code
            and keeps its live state in memory.
          </p>
          <pre className="rounded-md bg-background p-3 text-xs overflow-auto">
            cd apps/dashboard{"\n"}npm run connector -- --dashboard{" "}
            {location.origin}
          </pre>
          <p>
            Open the paired link printed by the connector. No account or login
            password is required. Your browser may ask permission to access the
            local network.
          </p>
          <p className="text-xs">
            {online
              ? "Connected to your local computer."
              : "Install and build DBDeck from the source repository first. See the dashboard README."}
          </p>
          <div className="dialog-actions">
            <Button onClick={() => setConnect(false)}>Done</Button>
          </div>
        </Dialog>
      )}
      {nameDialog && (
        <Dialog close={() => setNameDialog(false)}>
          <h2>New local project</h2>
          <p>
            Create a separate set of connections on this device. Protection is
            optional in Settings.
          </p>
          <Input
            aria-label="Project name"
            placeholder="My project"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setNameDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createProject().catch(fail)}>
              Create project
            </Button>
          </div>
        </Dialog>
      )}
      {deleteDialog && (
        <Dialog close={() => setDeleteDialog(false)}>
          <h2>Delete this local project?</h2>
          <p>
            This permanently removes its saved connections and credentials from
            this browser. Keep an export first. Your actual databases are not
            deleted.
          </p>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void removeProject().catch(fail)}
            >
              Delete local project
            </Button>
          </div>
        </Dialog>
      )}
      {requests[0] && (
        <HostRequest
          key={requests[0].id}
          request={requests[0]}
          respond={(value, error) => {
            const request = requests[0];
            setRequests((items) => items.slice(1));
            void rpc("respond", { id: request.id, value, error }).catch(fail);
          }}
        />
      )}
      {picker && (
        <Dialog
          close={() => {
            void rpc("picker-close", { id: picker.id }).catch(fail);
            setPicker(null);
          }}
        >
          <h2>{picker.placeholder || "Search DBDeck"}</h2>
          <Input
            aria-label="Search DBDeck"
            autoFocus
            onChange={(event) =>
              void rpc("picker-change", {
                id: picker.id,
                value: event.target.value,
              }).catch(fail)
            }
          />
          <div className="pick-list">
            {picker.items.map((item: any, index: number) => (
              <button
                key={index}
                onClick={() =>
                  void rpc("picker-accept", { id: picker.id, index }).catch(
                    fail,
                  )
                }
              >
                {cleanLabel(item.label)}
                <small>{item.description}</small>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {menu && (
        <div className="menu-overlay" onClick={() => setMenu(null)}>
          <div
            role="menu"
            className="command-menu"
            style={{ left: menu.x, top: menu.y }}
          >
            {(manifest?.menus?.["view/item/context"] || [])
              .filter((entry: any) => matches(entry.when, menu.row.context))
              .map((entry: any) => (
                <button
                  role="menuitem"
                  key={entry.command}
                  onClick={() => {
                    run(entry.command, menu.row.node);
                    setMenu(null);
                  }}
                >
                  {manifest.commands.find(
                    (c: any) => c.command === entry.command,
                  )?.title || entry.command}
                </button>
              ))}
          </div>
        </div>
      )}
      {external && (
        <Dialog close={() => setExternal("")}>
          <h2>Open in your browser</h2>
          <p>Continue to the provider or external page.</p>
          <a
            href={external}
            target="_blank"
            rel="noreferrer"
            className="text-brand break-all"
            onClick={() => setExternal("")}
          >
            {external}
          </a>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setExternal("")}>
              Close
            </Button>
          </div>
        </Dialog>
      )}
      {!accepted && (
        <Dialog>
          <h2>Your workspace. Your responsibility.</h2>
          <p>
            DBDeck is free, open source software provided without warranties, to
            the extent permitted by law. Database commands can change or delete
            real data. Keep backups and use read-only access when appropriate.
          </p>
          <p>
            Projects stay on your device. Phrase and passkey protection are
            optional. Clearing browser data can permanently remove your
            projects.
          </p>
          <label className="flex items-start gap-3 mt-5 leading-6">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1.5"
            />
            <span>
              I accept the{" "}
              <a
                href={`${legalOrigin}/terms/`}
                target="_blank"
                rel="noreferrer"
                className="text-brand"
              >
                Terms of Use
              </a>{" "}
              and have read the{" "}
              <a
                href={`${legalOrigin}/privacy/`}
                target="_blank"
                rel="noreferrer"
                className="text-brand"
              >
                Privacy Notice
              </a>
              .
            </span>
          </label>
          <div className="dialog-actions">
            <Button
              disabled={!consent}
              onClick={() => {
                localStorage.setItem("dbdeck.terms.v1", "accepted");
                setAccepted(true);
              }}
            >
              Open workspace
            </Button>
          </div>
        </Dialog>
      )}
      {notice && (
        <div
          role={notice.error ? "alert" : "status"}
          className={`notice ${notice.error ? "notice-error" : "notice-success"}`}
        >
          {notice.error ? <CircleAlert /> : <CircleCheck />}
          <span>{notice.message}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss notice"
            onClick={() => setNotice(null)}
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
