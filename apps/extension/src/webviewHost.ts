import * as vscode from 'vscode';
import { errorMessage } from './util';

export type Handlers = Record<string, (params: any) => unknown>;

export function webviewHtml(webview: vscode.Webview, extUri: vscode.Uri, script: string, title: string, init: unknown, styles = ['codicon.css', 'style.css']): string {
  const asset = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'dist', 'webview', f)).toString();
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const state = JSON.stringify(init ?? {}).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
${styles.map((f) => `<link rel="stylesheet" href="${asset(f)}">`).join('\n')}
<title>${title.replace(/</g, '&lt;')}</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">window.__INIT__ = ${state};</script>
<script nonce="${nonce}" src="${asset(`${script}.js`)}"></script>
</body>
</html>`;
}

export function bindRpc(webview: vscode.Webview, handlers: Handlers): vscode.Disposable {
  return webview.onDidReceiveMessage(async (msg: { type: string; id?: number; method?: string; params?: unknown }) => {
    if (msg?.type !== 'rpc' || !msg.method) return;
    const h = handlers[msg.method];
    try {
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
