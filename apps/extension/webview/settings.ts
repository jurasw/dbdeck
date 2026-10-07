import { btn, clear, h, icon, onMessage, rpc, toast } from './lib';

interface State {
  ai: { provider: string; model: string; account?: string; connected: boolean };
  settings: Record<string, unknown>;
  chat: { id: string; name: string }[];
  mcp: { id: string; name: string }[];
  connections: number;
}

const PROVIDERS: Record<string, string> = {
  chatgpt: 'OpenAI · ChatGPT sign-in',
  openai: 'OpenAI · API key',
  anthropic: 'Anthropic · Claude API key',
  compatible: 'OpenAI-compatible API',
  ollama: 'Ollama · local',
};

document.body.classList.add('settings-page');
const app = document.getElementById('app')!;
let state: State | undefined;

async function call(method: string, params?: unknown) {
  try {
    const next = await rpc<State | undefined>(method, params);
    if (next) render(next);
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

function section(iconName: string, title: string, description: string, ...rows: (Node | null)[]): HTMLElement {
  return h(
    'section.settings-section',
    null,
    h('div.settings-section-head', null, h('span.settings-icon', null, icon(iconName)), h('div', null, h('h2', null, title), h('p', null, description))),
    h('div.settings-rows', null, rows),
  );
}

function row(label: string, description: string, control: Node, badge?: Node): HTMLElement {
  return h(
    'div.settings-row',
    null,
    h('div.settings-label', null, h('div.settings-title', null, h('strong', null, label), badge), h('span', null, description)),
    h('div.settings-control', null, control),
  );
}

function actions(...buttons: (Node | null)[]): HTMLElement {
  return h('div.settings-inline', null, buttons);
}

function numberSetting(key: string, min: number, max: number): HTMLElement {
  const input = h('input.input', { type: 'number', min, max, step: 1, value: String(state!.settings[key] ?? '') }) as HTMLInputElement;
  input.addEventListener('change', () => void call('set', { key, value: input.value }));
  return input;
}

function textSetting(key: string): HTMLElement {
  const input = h('input.input', { type: 'text', value: String(state!.settings[key] ?? '') }) as HTMLInputElement;
  input.addEventListener('change', () => void call('set', { key, value: input.value }));
  return input;
}

function toggle(key: string): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: !!state!.settings[key] }) as HTMLInputElement;
  input.addEventListener('change', () => void call('set', { key, value: input.checked }));
  return h('label.settings-switch', null, input, h('span'));
}

function allowList(list: 'chat' | 'mcp', items: { id: string; name: string }[], empty: string): HTMLElement {
  if (!items.length) return h('span.settings-muted', null, empty);
  return h(
    'div.settings-list',
    null,
    items.length > 1 ? btn('Remove all', { class: 'sm ghost', onClick: () => void call('forget', { list }) }) : null,
    items.map((c) =>
      h(
        'div.settings-chip',
        null,
        icon('database'),
        c.name,
        btn(null, { icon: 'close', class: 'sm ghost', title: `Remove ${c.name}`, onClick: () => void call('forget', { list, id: c.id }) }),
      ),
    ),
  );
}

function render(next: State) {
  state = next;
  const ai = next.ai;
  const connected = ai.connected && !!ai.model;
  clear(
    app,
    h(
      'main.settings-main',
      null,
      h(
        'header.settings-header',
        null,
        h('span.ai-mark', null, icon('settings-gear')),
        h('div', null, h('h1', null, 'Settings'), h('p', null, 'DBDeck preferences for this editor. Nothing is synced or sent anywhere.')),
      ),
      section(
        'sparkle',
        'AI',
        'Used by AI queries, AI filters and Chat with Database. Requests go straight from your editor to the provider.',
        row(
          'Provider',
          PROVIDERS[ai.provider] ?? ai.provider,
          btn('Change provider', { class: 'sm', onClick: () => void call('ai', { action: 'configure' }) }),
          h('span.settings-badge', { class: connected ? 'on' : undefined }, h('span.chat-dot', { class: connected ? 'on' : undefined }), connected ? 'Connected' : 'Not connected'),
        ),
        row('Model', ai.model || 'No model chosen', btn('Choose model', { class: 'sm', onClick: () => void call('ai', { action: 'model' }) })),
        ai.provider === 'chatgpt'
          ? row(
              'ChatGPT account',
              ai.account ?? 'Not signed in',
              actions(
                btn('Usage', { icon: 'link-external', class: 'sm ghost', onClick: () => void rpc('usage') }),
                btn(ai.connected ? 'Switch account' : 'Sign in', { class: 'sm', onClick: () => void call('ai', { action: 'signIn' }) }),
              ),
            )
          : null,
        ai.connected && ai.provider !== 'ollama'
          ? row(
              'Sign out',
              'Remove the stored key or ChatGPT session from this editor.',
              btn('Disconnect', { class: 'sm danger', onClick: () => void call('ai', { action: 'disconnect' }) }),
            )
          : null,
        row('Chat queries', 'Connections where the chat assistant may run read-only queries. Their results go to your AI provider.', allowList('chat', next.chat, 'None yet')),
      ),
      section(
        'plug',
        'AI agents (MCP)',
        'A local MCP server for Claude Code, Cursor, Copilot and Codex. It listens on 127.0.0.1 only.',
        row('MCP server', 'Agents can read schema and run read-only queries on connections you allow.', toggle('mcp.enabled')),
        row('Rows per query', 'Maximum rows an agent gets from one query.', numberSetting('mcp.maxRows', 1, 5000)),
        row('Allowed connections', 'Agents asked to read these and you allowed it.', allowList('mcp', next.mcp, 'None yet')),
        row(
          'Set up an agent',
          'Copy the Claude Code command or MCP JSON, or regenerate the access token.',
          btn('Set up agent', { class: 'sm', onClick: () => void call('command', { id: 'dbdeck.mcpSetup' }) }),
        ),
      ),
      section(
        'table',
        'Data viewer and editor',
        'How tables and query results load.',
        row('Rows per page', 'Rows loaded per page in the data viewer.', numberSetting('pageSize', 10, 10000)),
        row('Rows per result', 'Maximum rows kept from one query in Results.', numberSetting('maxResultRows', 100, 1000000)),
        row('Run CodeLens', 'Show ▶ Run above each statement in bound SQL editors.', toggle('codeLens')),
      ),
      section(
        'key',
        'Redis',
        'Key tree options.',
        row('Keys per database', 'Maximum keys loaded into the tree per database.', numberSetting('redisScanLimit', 100, 1000000)),
        row('Key separator', 'Groups keys into folders, such as user:42.', textSetting('redisKeySeparator')),
      ),
      section(
        'database',
        'Connections',
        `${next.connections} connection${next.connections === 1 ? '' : 's'}. Passwords stay in the OS keychain.`,
        row(
          'Back up or move',
          'Export to a JSON file, with or without passwords, or import one.',
          h(
            'div.settings-inline',
            null,
            btn('Import…', { class: 'sm', onClick: () => void call('command', { id: 'dbdeck.importConnections' }) }),
            btn('Export…', { class: 'sm', onClick: () => void call('command', { id: 'dbdeck.exportConnections' }) }),
          ),
        ),
      ),
      h('footer.settings-footer', null, btn('Open in editor settings', { icon: 'json', class: 'sm ghost', onClick: () => void rpc('native') })),
    ),
  );
}

onMessage('settings:state', ({ state: next }: { state: State }) => render(next));
void call('state');
