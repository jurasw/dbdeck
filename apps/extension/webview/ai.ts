import { btn, clear, flash, h, icon, INIT, rpc, typeOut } from './lib';

interface Status {
  provider: string;
  model: string;
  account?: string;
  connected: boolean;
}
document.body.classList.add('ai-page');
const app = document.getElementById('app')!;
const status = h('p');
const connectionStatus = h('span.ai-count');
const selectionCount = h('span.ai-count');
const error = h('p', { role: 'alert', style: 'color:var(--vscode-errorForeground)' });
const prompt = h('textarea.textarea', {
  id: 'ai-prompt',
  rows: 5,
  placeholder: 'e.g. Show the 10 customers with the highest order total this month',
  maxlength: 10000,
  style: 'width:100%;resize:vertical',
});
const preview = h('pre', { tabindex: 0, style: 'white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:var(--vscode-textCodeBlock-background)' });
const tables = h('div.ai-table-list');
const search = h('input.input', {
  type: 'search',
  placeholder: 'Search tables…',
  'aria-label': 'Search schema tables',
  onInput: () => {
    for (const row of Array.from(tables.children) as HTMLElement[]) row.hidden = !row.textContent?.toLowerCase().includes(search.value.toLowerCase());
  },
});
const selected = new Set<number>();
for (const object of INIT.objects as { index: number; label: string }[]) {
  selected.add(object.index);
  tables.append(h('div.ai-table-row', null, icon('table'), h('span', null, object.label)));
}
selectionCount.textContent = `${selected.size} tables · automatic context`;
let busy = false;
let connected = false;
async function action(method: string) {
  error.textContent = '';
  generate.disabled = true;
  controls.forEach((b) => (b.disabled = true));
  try {
    renderStatus(await rpc<Status>(method));
  } catch (e) {
    error.textContent = (e as Error).message;
  } finally {
    controls.forEach((b) => (b.disabled = busy));
    generate.disabled = busy;
  }
}
const configure = btn('AI provider', {
  icon: 'settings-gear',
  onClick: () => {
    void action('configure');
  },
});
const signIn = btn('Continue with ChatGPT', {
  onClick: () => {
    void action('signIn');
  },
});
const model = btn('Choose model', {
  onClick: () => {
    void action('model');
  },
});
const disconnect = btn('Disconnect', {
  onClick: () => {
    void action('disconnect');
  },
});
const usage = btn('ChatGPT usage', {
  onClick: () => {
    void rpc('usage');
  },
});
const agents = btn('AI agents (MCP)', {
  icon: 'plug',
  title: 'Let Claude Code, Cursor or Copilot read this database through MCP',
  onClick: () => {
    void rpc('mcp');
  },
});
const chat = btn('Chat with database', {
  icon: 'comment-discussion',
  title: 'Ask questions about this database in a chat',
  onClick: () => {
    void rpc('chat');
  },
});
const controls = [configure, signIn, model, disconnect];
const insert = btn('Open in query editor', {
  icon: 'go-to-file',
  disabled: true,
  onClick: async () => {
    try {
      await rpc('insert');
    } catch (e) {
      error.textContent = (e as Error).message;
    }
  },
});
const cancel = btn('Cancel', {
  disabled: true,
  onClick: () => {
    void rpc('cancel');
  },
});
const generate = btn('Generate query', {
  icon: 'sparkle',
  class: 'primary',
  onClick: async () => {
    if (busy) return;
    if (!connected) {
      error.textContent = 'Connect an AI provider first.';
      return;
    }
    if (!prompt.value.trim() || !selected.size) {
      error.textContent = 'Describe your query. The current context must contain at least one table.';
      return;
    }
    busy = true;
    generate.disabled = true;
    cancel.disabled = false;
    insert.disabled = true;
    controls.forEach((b) => (b.disabled = true));
    error.textContent = '';
    preview.textContent = 'Generating…';
    preview.classList.add('ai-pending');
    prompt.parentElement?.classList.add('ai-busy');
    emptyPreview.hidden = true;
    try {
      const sql = await rpc<string>('generate', { prompt: prompt.value });
      preview.classList.remove('ai-pending');
      prompt.parentElement?.classList.remove('ai-busy');
      preview.classList.add('ai-streaming');
      await typeOut(sql, (value) => (preview.textContent = value), 900);
      insert.disabled = false;
      flash(insert, 'ai-attention');
    } catch (e) {
      preview.textContent = '';
      emptyPreview.hidden = false;
      error.textContent = (e as Error).message;
    } finally {
      preview.classList.remove('ai-pending', 'ai-streaming');
      prompt.parentElement?.classList.remove('ai-busy');
      busy = false;
      generate.disabled = false;
      cancel.disabled = true;
      controls.forEach((b) => (b.disabled = false));
    }
  },
});
function renderStatus(value: Status) {
  connected = value.connected && !!value.model;
  connectionStatus.textContent = `${value.provider} · ${value.model || 'Choose model'}`;
  status.textContent = `${value.provider}${value.account ? ` · ${value.account}` : ''} · ${value.model || 'Choose a model'} · ${value.connected ? 'Connected' : 'Disconnected'}`;
  usage.hidden = value.provider !== 'chatgpt';
  signIn.hidden = value.provider !== 'chatgpt';
  signIn.textContent = value.connected ? 'Switch ChatGPT account' : 'Continue with ChatGPT';
  disconnect.hidden = !value.connected || value.provider === 'ollama';
  settings.hidden = !(INIT.settings || !connected);
}
const emptyPreview = h(
  'div.ai-empty',
  null,
  icon('code'),
  h('strong', null, 'Your SQL starts here'),
  h('p', null, 'Describe what you need. Your database context is already included.'),
);
const settings = h(
  'section.ai-card',
  null,
  h('h2', null, 'AI settings'),
  h(
    'div.ai-settings-body',
    null,
    status,
    h('div.ai-actions', null, configure, model, signIn, disconnect, usage),
    h(
      'details.ai-privacy',
      null,
      h('summary', null, 'Privacy and data sent to your provider'),
      h(
        'p',
        null,
        'Your request and the selected table names, column names and types go directly to your provider. Row data and database credentials are never included. Your provider handles the request under its own data policy. Credentials stay in your editor. DBDeck has no backend.',
      ),
    ),
  ),
);
clear(
  app,
  h(
    'main.ai-main',
    null,
    h(
      'header.ai-header',
      null,
      h('div.row', null, h('span.ai-mark', null, icon('sparkle')), h('div', null, h('h1', null, 'AI Query'), h('p.ai-muted', null, `${INIT.connection} › ${INIT.database}`))),
      h('div.ai-actions', null, connectionStatus),
      h(
        'div.ai-actions',
        null,
        chat,
        agents,
        btn(null, {
          icon: 'settings-gear',
          class: 'ai-settings-toggle ghost',
          title: 'AI settings',
          onClick: () => {
            settings.hidden = !settings.hidden;
            if (!settings.hidden) settings.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          },
        }),
      ),
    ),
    INIT.settings
      ? btn('Back to table', {
          icon: 'arrow-left',
          onClick: () => {
            void rpc('back');
          },
        })
      : null,
    settings,
    h(
      'div.ai-workspace',
      null,
      h(
        'details.ai-context',
        null,
        h('summary.ai-section-head', null, h('span', null, 'Database context'), selectionCount),
        search,
        tables,
        h('p.ai-muted.ai-context-note', null, 'Only names and column types are shared. Row data stays in your database.'),
      ),
      h(
        'div.ai-editor',
        null,
        h(
          'section.ai-compose',
          null,
          h('div.ai-section-head', null, h('label', { for: 'ai-prompt' }, 'Describe your query'), h('span.ai-count', null, String(INIT.dialect))),
          h('div.ai-prompt-box', null, prompt, h('div.ai-compose-footer', null, h('span.ai-muted', null, 'Write in any language'), h('div.ai-actions', null, cancel, generate))),
          error,
        ),
        h(
          'section.ai-result',
          null,
          h('div.ai-section-head', null, h('h2', null, 'Query preview'), h('span.ai-count', null, 'SQL')),
          emptyPreview,
          preview,
          h('div.ai-result-footer', null, h('p.ai-muted', null, 'Review before running. Nothing executes automatically.'), insert),
        ),
      ),
    ),
    h('footer.ai-footer', null, h('span.ai-muted', null, 'Use your own AI provider · credentials stay in your editor')),
  ),
);
void action('status');
