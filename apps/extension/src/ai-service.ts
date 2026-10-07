import { join } from 'node:path';
import { withLocalLock } from './local-lock';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { ChatMessage, ChatReply, ChatTool } from './ai-chat';
import { AiOptions, chatReply, generateQuery, validateEndpoint } from './ai-client';
import { listClaudeModels } from './claude-client';
import { ChatGptAccount, refreshChatGpt, revokeChatGpt, signInChatGpt } from './openai-auth';

const optionsKey = 'dbdeck.ai.options';
const accountKey = 'dbdeck.ai.chatgpt.accounts';
export class AiService {
  private refreshes = new Map<string, Promise<ChatGptAccount>>();
  private authenticating = false;
  private sessionEpoch = 0;
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  private withCredentialsLock<T>(action: () => Promise<T>): Promise<T> {
    return withLocalLock(join(this.ctx.globalStorageUri.fsPath, 'ai-credentials.lock'), action);
  }

  options(): AiOptions {
    return this.ctx.globalState.get<AiOptions>(optionsKey, { provider: 'chatgpt', baseUrl: 'https://api.openai.com/v1', model: '' });
  }
  private async accounts(): Promise<ChatGptAccount[]> {
    return JSON.parse((await this.ctx.secrets.get(accountKey)) ?? '[]') as ChatGptAccount[];
  }
  private async saveAccount(account: ChatGptAccount): Promise<void> {
    const accounts = await this.accounts();
    const index = accounts.findIndex((a) => a.clientId === account.clientId && a.subject === account.subject);
    if (index < 0) accounts.push(account);
    else accounts[index] = account;
    await this.ctx.secrets.store(accountKey, JSON.stringify(accounts));
  }
  private async selectedAccount(): Promise<ChatGptAccount | undefined> {
    const selected = this.ctx.globalState.get<string>('dbdeck.ai.chatgpt.selected');
    return (await this.accounts()).find((a) => a.clientId === selected);
  }
  async status(): Promise<{ provider: string; model: string; account?: string; connected: boolean }> {
    const options = this.options();
    const account = options.provider === 'chatgpt' ? await this.selectedAccount() : undefined;
    return {
      provider: options.provider,
      model: options.model,
      account: account?.email,
      connected: options.provider === 'ollama' || (options.provider === 'chatgpt' ? !!account?.refreshToken : !!(await this.ctx.secrets.get(`dbdeck.ai.key.${options.provider}`))),
    };
  }
  async configure(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      [
        { label: 'OpenAI · Continue with ChatGPT', description: 'Use your own ChatGPT plan', provider: 'chatgpt' as const },
        { label: 'OpenAI · API key', description: 'Billed to your own API account', provider: 'openai' as const },
        { label: 'Anthropic · Claude API key', description: 'Billed to your own Claude Console account', provider: 'anthropic' as const },
        { label: 'OpenAI-compatible API', description: 'Your own provider and API key', provider: 'compatible' as const },
        { label: 'Ollama · Local', description: 'Run models on your computer', provider: 'ollama' as const },
      ],
      { title: 'DBDeck AI provider', placeHolder: 'Requests go directly to your provider. DBDeck has no backend.' },
    );
    if (!picked) return;
    const previous = this.options();
    let baseUrl = picked.provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : picked.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
    if (picked.provider === 'compatible' || picked.provider === 'ollama') {
      const url = await vscode.window.showInputBox({
        title: 'AI API base URL',
        value: previous.provider === picked.provider ? previous.baseUrl : baseUrl,
        prompt: 'OpenAI-compatible API base URL, including /v1',
        validateInput: (s) => {
          try {
            validateEndpoint(s);
            return undefined;
          } catch (e) {
            return (e as Error).message;
          }
        },
      });
      if (!url) return;
      baseUrl = validateEndpoint(url);
    }
    if (picked.provider === 'openai' || picked.provider === 'anthropic' || picked.provider === 'compatible') {
      const key = await vscode.window.showInputBox({
        title: picked.provider === 'anthropic' ? 'Your Claude API key from platform.claude.com' : 'Your AI provider API key',
        password: true,
        ignoreFocusOut: true,
        prompt: 'Stored only in your editor’s SecretStorage. Requests are billed to your account.',
      });
      if (key === undefined) return;
      if (key.trim()) await this.ctx.secrets.store(`dbdeck.ai.key.${picked.provider}`, key.trim());
      else if (picked.provider === 'compatible' || !(await this.ctx.secrets.get(`dbdeck.ai.key.${picked.provider}`))) throw new Error('Enter an API key.');
    }
    await this.ctx.globalState.update(optionsKey, { provider: picked.provider, baseUrl, model: previous.provider === picked.provider ? previous.model : '' });
    if (picked.provider === 'chatgpt') await this.signIn();
    else await this.chooseModel();
  }
  async signIn(): Promise<void> {
    if (this.authenticating) throw new Error('An OpenAI sign-in is already in progress.');
    this.authenticating = true;
    try {
      const accounts = await this.accounts();
      const pick = accounts.length
        ? await vscode.window.showQuickPick(
            [
              ...accounts.map((account) => ({ label: account.email ?? account.subject, description: account.clientId, account })),
              { label: 'Add a ChatGPT account', description: 'Sign in through OpenAI', account: undefined },
            ],
            { title: 'Continue with ChatGPT', placeHolder: 'Choose an account or add another' },
          )
        : { account: undefined };
      if (!pick) return;
      let hostId = this.ctx.globalState.get<string>('dbdeck.ai.chatgpt.host');
      if (!hostId) {
        hostId = `urn:uuid:${randomUUID()}`;
        await this.ctx.globalState.update('dbdeck.ai.chatgpt.host', hostId);
      }
      const account = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Continue with ChatGPT · finish sign-in in your browser', cancellable: true },
        async (_, cancellation) => {
          const controller = new AbortController();
          const sub = cancellation.onCancellationRequested(() => controller.abort());
          try {
            return await signInChatGpt(hostId!, (url) => Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))), controller.signal, pick.account);
          } finally {
            sub.dispose();
          }
        },
      );
      await this.withCredentialsLock(() => this.saveAccount(account));
      await this.ctx.globalState.update('dbdeck.ai.chatgpt.selected', account.clientId);
      await this.ctx.globalState.update(optionsKey, { provider: 'chatgpt', baseUrl: 'https://api.openai.com/v1', model: '' });
      await this.chooseModel();
    } finally {
      this.authenticating = false;
    }
  }
  async disconnect(): Promise<void> {
    if (this.authenticating) throw new Error('Finish or cancel sign-in before disconnecting.');
    this.sessionEpoch++;
    const options = this.options();
    if (options.provider !== 'chatgpt') {
      await this.ctx.secrets.delete(`dbdeck.ai.key.${options.provider}`);
      return;
    }
    await this.withCredentialsLock(async () => {
      const account = await this.selectedAccount();
      if (!account) return;
      try {
        await revokeChatGpt(account);
      } catch {
        void vscode.window.showWarningMessage('Signed out locally. Remote revocation was not confirmed; disconnect DBDeck in ChatGPT Settings.');
      }
      await this.saveAccount({ ...account, accessToken: undefined, refreshToken: undefined, idToken: undefined, expiresAt: undefined, scopes: [] });
    });
  }

  private async token(options = this.options()): Promise<string | undefined> {
    if (options.provider === 'ollama') return undefined;
    if (options.provider !== 'chatgpt') {
      const key = await this.ctx.secrets.get(`dbdeck.ai.key.${options.provider}`);
      if (!key) throw new Error('Connect your AI provider first.');
      return key;
    }
    let account = await this.selectedAccount();
    if (!account?.refreshToken) throw new Error('Continue with ChatGPT to sign in first.');
    if (!account.accessToken || (account.expiresAt ?? 0) < Date.now() + 60000) {
      let pending = this.refreshes.get(account.clientId);
      if (!pending) {
        const id = account.clientId;
        const epoch = this.sessionEpoch;
        pending = this.withCredentialsLock(async () => {
          if (epoch !== this.sessionEpoch) throw new Error('AI session was disconnected.');
          const current = (await this.accounts()).find((a) => a.clientId === id);
          if (!current?.refreshToken) throw new Error('Sign in with ChatGPT first.');
          if (current.accessToken && (current.expiresAt ?? 0) >= Date.now() + 60000) return current;
          const next = await refreshChatGpt(current);
          if (epoch !== this.sessionEpoch) throw new Error('AI session was disconnected.');
          await this.saveAccount(next);
          return next;
        }).finally(() => this.refreshes.delete(id));
        this.refreshes.set(id, pending);
      }
      account = await pending;
    }
    return account.accessToken;
  }
  async chooseModel(): Promise<void> {
    const options = this.options();
    if (options.provider === 'chatgpt') {
      const token = await this.token();
      const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!response.ok) throw new Error(`Cannot list ChatGPT models (HTTP ${response.status}). Check your plan permissions.`);
      const body = (await response.json()) as { models?: { slug: string; display_name: string; visibility: string }[] };
      const items = (body.models ?? []).filter((m) => m.visibility === 'list').map((m) => ({ label: m.display_name, description: m.slug }));
      if (!items.length) throw new Error('No models are available for this ChatGPT account.');
      const model = await vscode.window.showQuickPick(items, { title: 'ChatGPT model', placeHolder: 'Usage comes from your ChatGPT plan or credits' });
      if (model) await this.ctx.globalState.update(optionsKey, { ...options, model: model.description });
    } else if (options.provider === 'anthropic') {
      const models = await listClaudeModels((await this.token(options))!);
      if (!models.length) throw new Error('No Claude models are available for this API key.');
      const model = await vscode.window.showQuickPick(
        models.map((m) => ({ label: m.name, description: m.id === 'claude-opus-5-5' ? `${m.id} · recommended` : m.id, id: m.id })),
        { title: 'Claude model', placeHolder: 'Usage is billed to your Claude Console account' },
      );
      if (model) await this.ctx.globalState.update(optionsKey, { ...options, model: model.id });
    } else {
      const model = await vscode.window.showInputBox({
        title: 'AI model',
        value: options.model,
        prompt: 'Enter the model ID from your provider, or an installed Ollama model',
        validateInput: (s) => (s.trim() ? undefined : 'Enter a model ID.'),
      });
      if (model?.trim()) await this.ctx.globalState.update(optionsKey, { ...options, model: model.trim() });
    }
  }
  async chat(system: string, history: ChatMessage[], tools: ChatTool[], signal: AbortSignal): Promise<ChatReply> {
    const options = this.options();
    if (!options.model.trim()) throw new Error('Choose an AI model first.');
    return chatReply(options, await this.token(options), system, history, tools, signal);
  }
  async generate(prompt: string, schema: string, dialect: string, signal: AbortSignal, filter = false): Promise<string> {
    if (!prompt.trim() || prompt.length > 10000) throw new Error('Describe your query using 1–10,000 characters.');
    if (schema.length > 100000) throw new Error('The selected schema is too large. Choose fewer tables.');
    const options = this.options();
    const token = await this.token(options);
    return generateQuery(options, token, prompt, schema, dialect, signal, filter);
  }
}
