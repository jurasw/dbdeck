import { readFileSync, statSync } from 'node:fs';
import * as vscode from 'vscode';
import { errorMessage } from './util';

export type Handlers = Record<string, (params: any) => unknown>;

const assets = new Map<string, { mtime: number; text: string }>();

function readAsset(extUri: vscode.Uri, file: string, encoding: BufferEncoding = 'utf8'): string {
  const path = vscode.Uri.joinPath(extUri, 'dist', 'webview', file).fsPath;
  const key = `${path}:${encoding}`;
  const mtime = statSync(path).mtimeMs;
  const cached = assets.get(key);
  if (cached?.mtime === mtime) return cached.text;
  const text = readFileSync(path).toString(encoding);
  assets.set(key, { mtime, text });
  return text;
}

export function webviewHtml(webview: vscode.Webview, extUri: vscode.Uri, script: string, title: string, init: unknown, styles = ['codicon.css', 'style.css']): string {
  const asset = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'dist', 'webview', f)).toString();
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const state = JSON.stringify(init ?? {}).replace(/</g, '\\u003c');
  const css = styles
    .map((f) =>
      readAsset(extUri, f)
        // Icons are needed on the first frame too. Avoid another editor resource request.
        .replace(/url\((["']?)\.\/codicon\.ttf(?:\?[^"')]+)?\1\)/g, () => `url("data:font/ttf;base64,${readAsset(extUri, 'codicon.ttf', 'base64')}")`)
        .replace(/url\((["']?)\.\/([^"')?#]+)/g, (_, q: string, file: string) => `url(${q}${asset(file)}`),
    )
    .join('\n');
  const js = readAsset(extUri, `${script}.js`).replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<style>${css}</style>
<title>${title.replace(/</g, '&lt;')}</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">window.__INIT__ = ${state};</script>
<script nonce="${nonce}">${js}</script>
</body>
</html>`;
}

export function bindRpc(webview: vscode.Webview, handlers: Handlers | Promise<Handlers>): vscode.Disposable {
  return webview.onDidReceiveMessage(async (msg: { type: string; id?: number; method?: string; params?: unknown }) => {
    if (msg?.type !== 'rpc' || !msg.method) return;
    try {
      const h = (await handlers)[msg.method];
      if (!h) throw new Error(`Unknown method ${msg.method}`);
      const result = await h(msg.params ?? {});
      void webview.postMessage({ type: 'rpc:res', id: msg.id, result });
    } catch (e) {
      void webview.postMessage({ type: 'rpc:res', id: msg.id, error: errorMessage(e) });
    }
  });
}

export function webviewOptions(extUri: vscode.Uri): vscode.WebviewOptions & vscode.WebviewPanelOptions {
  return {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(extUri, 'dist', 'webview'), vscode.Uri.joinPath(extUri, 'media')],
  };
}

export async function saveExport(defaultName: string, content: string): Promise<string | undefined> {
  const dir = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(require('os').homedir());
  const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(dir, defaultName) });
  if (!uri) return undefined;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  return uri.fsPath;
}
