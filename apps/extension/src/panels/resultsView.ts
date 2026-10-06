import * as vscode from 'vscode';
import { QueryResult } from '../types';
import { bindRpc, saveExport, webviewHtml, webviewOptions } from '../webviewHost';

export interface ResultBatch {
  location: string;
  results: QueryResult[];
}

export class ResultsView implements vscode.WebviewViewProvider {
  static readonly id = 'dbdeck.results';
  private view?: vscode.WebviewView;
  private pending: unknown[] = [];
  private ready = false;

  constructor(private readonly extUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = webviewOptions(this.extUri);
    view.webview.html = webviewHtml(view.webview, this.extUri, 'results', 'Results', {});
    const sub = bindRpc(view.webview, {
      ready: () => {
        this.ready = true;
        const p = this.pending;
        this.pending = [];
        p.forEach((m) => void view.webview.postMessage(m));
      },
      saveFile: ({ name, content }: { name: string; content: string }) => saveExport(name, content),
      copy: ({ text }: { text: string }) => vscode.env.clipboard.writeText(text),
      openInEditor: async ({ content, language }: { content: string; language: string }) => {
        const doc = await vscode.workspace.openTextDocument({ content, language });
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      },
    });
    view.onDidDispose(() => {
      sub.dispose();
      this.view = undefined;
      this.ready = false;
    });
  }

  private async post(msg: unknown): Promise<void> {
    if (!this.view || !this.ready) {
      this.pending.push(msg);
      if (!this.view) await vscode.commands.executeCommand(`${ResultsView.id}.focus`, { preserveFocus: true });
      return;
    }
    this.view.show(true);
    await this.view.webview.postMessage(msg);
  }

  running(location: string, label: string): Promise<void> {
    return this.post({ type: 'running', location, label });
  }

  show(batch: ResultBatch): Promise<void> {
    return this.post({ type: 'results', ...batch });
  }
}
