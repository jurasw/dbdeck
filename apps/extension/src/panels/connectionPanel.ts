import * as vscode from 'vscode';
import { ConnectionManager } from '../connections';
import { defaultSocket } from '../drivers/docker';
import { kibanaEndpoints } from '../drivers/elastic';
import { GoogleCredentials } from '../google-credentials';
import { gcloudLogin, googleIdentity, listBuckets, listProjects, STORAGE_SCOPE } from '../google-storage';
import { ConnectionConfig, DEFAULT_PORT } from '../types';
import { uid } from '../util';
import { bindRpc, webviewHtml, webviewOptions } from '../webviewHost';

export class ConnectionPanel {
  private static open = new Map<string, vscode.WebviewPanel>();

  static async show(extUri: vscode.Uri, manager: ConnectionManager, onSaved: (c: ConnectionConfig) => void, existing?: Partial<ConnectionConfig>): Promise<void> {
    const key = existing?.id ?? 'new';
    const prev = ConnectionPanel.open.get(key);
    if (prev && existing?.id) {
      prev.reveal();
      return;
    }
    const full = existing?.id ? await manager.store.full(existing.id) : existing;
    const panel = vscode.window.createWebviewPanel('dbdeck.connection', full?.name ? `Edit ${full.name}` : 'New Connection', vscode.ViewColumn.Active, webviewOptions(extUri));
    panel.iconPath = vscode.Uri.joinPath(extUri, 'media', 'activity.svg');
    ConnectionPanel.open.set(key, panel);
    const groups = [
      ...new Set(
        manager.store
          .list()
          .map((c) => c.group)
          .filter(Boolean),
      ),
    ];
    const init = {
      connection: full ?? null,
      defaults: DEFAULT_PORT,
      dockerSocket: defaultSocket(),
      groups,
      icons: Object.fromEntries(Object.keys(DEFAULT_PORT).map((t) => [t, panel.webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'types', `${t}.svg`)).toString()])),
    };
    panel.webview.html = webviewHtml(panel.webview, extUri, 'connection', 'Connection', init, ['connection.css']);
    const sub = bindRpc(panel.webview, {
      test: (c: ConnectionConfig) => manager.test(normalize(c)),
      save: async (c: ConnectionConfig) => {
        const cfg = normalize(c);
        cfg.id ||= uid();
        await manager.disconnect(cfg.id);
        await manager.store.save(cfg);
        onSaved(cfg);
        panel.dispose();
        return cfg.id;
      },
      pickKey: async () => {
        const r = await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: vscode.Uri.file(require('os').homedir() + '/.ssh'), openLabel: 'Use key' });
        return r?.[0]?.fsPath;
      },
      pickSqlite: async () =>
        (
          await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Open database',
            filters: { 'SQLite databases': ['db', 'sqlite', 'sqlite3', 'db3', 's3db', 'sl3'], 'All files': ['*'] },
          })
        )?.[0]?.fsPath,
      pickFile: async () => (await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Use file' }))?.[0]?.fsPath,
      cancel: () => panel.dispose(),
      googleStatus: async () => {
        try {
          return await googleIdentity(new GoogleCredentials(undefined, STORAGE_SCOPE));
        } catch {
          return null;
        }
      },
      googleSignIn: async () => {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Sign in with Google · finish in your browser', cancellable: true },
          async (_, cancellation) => {
            const controller = new AbortController();
            const sub = cancellation.onCancellationRequested(() => controller.abort());
            try {
              await gcloudLogin(controller.signal);
            } finally {
              sub.dispose();
            }
          },
        );
        return googleIdentity(new GoogleCredentials(undefined, STORAGE_SCOPE));
      },
      kibanaSignIn: async ({ url }: { url: string }) => {
        const { kibana } = kibanaEndpoints(url);
        await vscode.env.openExternal(vscode.Uri.parse(`${kibana}/app/management/security/api_keys`));
        const key = await vscode.window.showInputBox({
          title: 'Sign in to Kibana',
          prompt: 'Kibana opened in your browser. Sign in, click Create API key, then paste the Encoded key here.',
          password: true,
          ignoreFocusOut: true,
          validateInput: (v) => (v.trim() ? undefined : 'Paste the Encoded API key.'),
        });
        return key ? { kibana, apiKey: key.trim() } : null;
      },
      googleProjects: async () => listProjects(await new GoogleCredentials(undefined, STORAGE_SCOPE).token()),
      googleBuckets: async ({ project }: { project: string }) => listBuckets(await new GoogleCredentials(undefined, STORAGE_SCOPE).token(), project),
    });
    panel.onDidDispose(() => {
      sub.dispose();
      ConnectionPanel.open.delete(key);
    });
  }
}

function normalize(c: ConnectionConfig): ConnectionConfig {
  const out: ConnectionConfig = { ...c, name: c.name?.trim() || `${c.type} ${c.host ?? ''}`.trim() };
  out.port = c.port ? Number(c.port) : undefined;
  out.group = c.group?.trim() || undefined;
  if (out.ssh) {
    out.ssh.port = Number(out.ssh.port) || 22;
    if (!out.ssh.enabled) out.ssh = { ...out.ssh, enabled: false };
  }
  return out;
}
