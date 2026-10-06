import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { ConnectionManager } from './connections';
import { SqlDriver } from './drivers/sql';
import { QueryEditors } from './editor';
import { McpBackend, RunningMcpServer, startMcpServer } from './mcp-server';
import { FAMILY } from './types';

const tokenKey = 'dbdeck.mcp.token';
const portKey = 'dbdeck.mcp.port';
const allowedKey = 'dbdeck.mcp.allowed';

interface McpEditorApi {
  lm?: {
    registerMcpServerDefinitionProvider?: (
      id: string,
      provider: { onDidChangeMcpServerDefinitions: vscode.Event<void>; provideMcpServerDefinitions: () => Promise<unknown[]> },
    ) => vscode.Disposable;
  };
  McpHttpServerDefinition?: new (label: string, uri: vscode.Uri, headers?: Record<string, string>, version?: string) => unknown;
  cursor?: { mcp?: { registerServer(config: { name: string; server: { url: string; headers?: Record<string, string> } }): void; unregisterServer(name: string): void } };
}

export class McpService implements vscode.Disposable {
  private server?: RunningMcpServer;
  private syncing = Promise.resolve();
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changed];
  private readonly consents = new Map<string, Promise<void>>();
  private readonly api = vscode as unknown as McpEditorApi;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly manager: ConnectionManager,
    private readonly editors: QueryEditors,
  ) {
    const register = this.api.lm?.registerMcpServerDefinitionProvider;
    const Definition = this.api.McpHttpServerDefinition;
    if (register && Definition)
      this.disposables.push(
        register('dbdeck.mcp', {
          onDidChangeMcpServerDefinitions: this.changed.event,
          provideMcpServerDefinitions: async () => (this.server ? [new Definition('DBDeck', vscode.Uri.parse(this.url()), await this.headers(), this.version())] : []),
        }),
      );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('dbdeck.mcp.enabled')) void this.sync();
      }),
    );
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration('dbdeck').get<boolean>('mcp.enabled', false);
  }

  private version(): string {
    return String(this.ctx.extension.packageJSON.version ?? '0.0.0');
  }

  private url(): string {
    return `http://127.0.0.1:${this.server?.port}/mcp`;
  }

  private async token(): Promise<string> {
    let token = await this.ctx.secrets.get(tokenKey);
    if (!token) {
      token = randomBytes(32).toString('base64url');
      await this.ctx.secrets.store(tokenKey, token);
    }
    return token;
  }

  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.token()}` };
  }

  sync(): Promise<void> {
    this.syncing = this.syncing
      .then(async () => {
        if (this.enabled() && !this.server) await this.start();
        else if (!this.enabled() && this.server) await this.stop();
      })
      .catch((e) => {
        void vscode.window.showErrorMessage(`DBDeck MCP server: ${(e as Error).message}`);
      });
    return this.syncing;
  }

  private async start(): Promise<void> {
    const previous = this.ctx.globalState.get<number>(portKey, 0);
    this.server = await startMcpServer(this.backend(), { token: await this.token(), port: previous, version: this.version() });
    if (previous !== this.server.port) await this.ctx.globalState.update(portKey, this.server.port);
    if (previous && previous !== this.server.port)
      void vscode.window.showWarningMessage(`DBDeck MCP server moved to port ${this.server.port}. Update the setup in agents you configured manually.`);
    this.api.cursor?.mcp?.registerServer({ name: 'dbdeck', server: { url: this.url(), headers: await this.headers() } });
    this.changed.fire();
  }

  private async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.api.cursor?.mcp?.unregisterServer('dbdeck');
    this.changed.fire();
    await server?.close();
  }

  private async restart(): Promise<void> {
    await this.stop();
    await this.sync();
  }

  private consent(connectionId: string, name: string): Promise<void> {
    if (this.ctx.globalState.get<string[]>(allowedKey, []).includes(connectionId)) return Promise.resolve();
    let pending = this.consents.get(connectionId);
    if (!pending) {
      pending = (async () => {
        const answer = await vscode.window.showWarningMessage(
          `An AI agent wants to read "${name}" through the DBDeck MCP server.`,
          {
            modal: true,
            detail:
              'The agent can see table structure and the results of read-only queries. Results go to the agent’s AI provider. Changes always open in a query editor for your review.',
          },
          'Allow',
        );
        if (answer !== 'Allow') throw new Error(`The user did not allow access to "${name}".`);
        await this.ctx.globalState.update(allowedKey, [...this.ctx.globalState.get<string[]>(allowedKey, []), connectionId]);
      })().finally(() => this.consents.delete(connectionId));
      this.consents.set(connectionId, pending);
    }
    return pending;
  }

  private backend(): McpBackend {
    const driver = async (connectionId: string): Promise<SqlDriver> => {
      const config = this.manager.store.get(connectionId);
      if (!config || FAMILY[config.type] !== 'sql') throw new Error('Unknown SQL connection. Call list_connections first.');
      await this.consent(connectionId, config.name);
      const d = await this.manager.get(connectionId);
      if (!(d instanceof SqlDriver)) throw new Error('Unknown SQL connection. Call list_connections first.');
      return d;
    };
    return {
      connections: () =>
        this.manager.store
          .list()
          .filter((c) => FAMILY[c.type] === 'sql')
          .map((c) => ({ id: c.id, name: c.name, type: c.type, database: c.database || undefined })),
      databases: async (id) => (await driver(id)).databases(),
      tables: async (id, database, schema) => (await (await driver(id)).objects(database, schema, null)).slice(0, 2000),
      columns: async (id, database, table, schema) => (await driver(id)).columns({ database, schema, table }),
      query: async (id, database, sql) => (await driver(id)).runReadOnly(sql, database),
      open: async (id, database, sql) => {
        await driver(id);
        await this.editors.newQuery({ connId: id, kind: 'database', label: database, database }, `${sql.trim()}\n`);
      },
      maxRows: () => Math.max(1, Math.min(5000, vscode.workspace.getConfiguration('dbdeck').get<number>('mcp.maxRows', 200))),
    };
  }

  async setup(): Promise<void> {
    if (!this.enabled()) {
      const answer = await vscode.window.showWarningMessage(
        'Turn on the DBDeck MCP server?',
        {
          modal: true,
          detail:
            'AI agents on this computer that have the access token can list your SQL connections. They can read schema and run read-only queries only on connections you allow. The server listens on 127.0.0.1 only.',
        },
        'Turn On',
      );
      if (answer !== 'Turn On') return;
      await vscode.workspace.getConfiguration('dbdeck').update('mcp.enabled', true, vscode.ConfigurationTarget.Global);
    }
    await this.sync();
    if (!this.server) return;
    const auto = this.api.cursor?.mcp ? 'Cursor' : this.api.lm?.registerMcpServerDefinitionProvider ? 'VS Code' : undefined;
    const pick = await vscode.window.showQuickPick(
      [
        { label: '$(copy) Copy Claude Code command', id: 'claude' },
        { label: '$(json) Copy MCP JSON config', description: 'Cursor, Claude Desktop, Windsurf and other clients', id: 'json' },
        { label: '$(key) Regenerate access token', id: 'token' },
        { label: '$(clear-all) Forget allowed connections', id: 'forget' },
        { label: '$(circle-slash) Turn off MCP server', id: 'off' },
      ],
      { title: `DBDeck MCP server · ${this.url()}`, placeHolder: auto ? `${auto} agents already see DBDeck. Set up another agent:` : 'Set up an AI agent' },
    );
    if (!pick) return;
    if (pick.id === 'claude') {
      await vscode.env.clipboard.writeText(`claude mcp add --transport http dbdeck ${this.url()} --header "Authorization: Bearer ${await this.token()}"`);
      void vscode.window.showInformationMessage('Claude Code command copied. Run it in a terminal; it contains your DBDeck access token.');
    } else if (pick.id === 'json') {
      await vscode.env.clipboard.writeText(JSON.stringify({ mcpServers: { dbdeck: { type: 'http', url: this.url(), headers: await this.headers() } } }, null, 2));
      void vscode.window.showInformationMessage('MCP config copied. It contains your DBDeck access token.');
    } else if (pick.id === 'token') {
      await this.ctx.secrets.delete(tokenKey);
      await this.restart();
      void vscode.window.showInformationMessage('Access token regenerated. Update agents you configured manually.');
    } else if (pick.id === 'forget') {
      await this.ctx.globalState.update(allowedKey, []);
      void vscode.window.showInformationMessage('Agents must ask again before they read a connection.');
    } else {
      await vscode.workspace.getConfiguration('dbdeck').update('mcp.enabled', false, vscode.ConfigurationTarget.Global);
      await this.sync();
    }
  }

  dispose(): void {
    void this.stop();
    for (const d of this.disposables) d.dispose();
  }
}
