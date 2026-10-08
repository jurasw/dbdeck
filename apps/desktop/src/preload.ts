import { contextBridge, ipcRenderer } from "electron";

// Keep the extension's webview protocol; expose no filesystem or generic IPC.
let state: unknown;
contextBridge.exposeInMainWorld("acquireVsCodeApi", () => ({
  postMessage: (message: unknown) =>
    ipcRenderer.send("dbdeck:message", message),
  getState: () => state,
  setState: (value: unknown) => {
    state = value;
    return value;
  },
}));
contextBridge.exposeInMainWorld("dbdeckMessages", {
  subscribe: (listener: (message: unknown) => void) => {
    ipcRenderer.on("dbdeck:message", (_event, message: unknown) =>
      listener(message),
    );
  },
});
