import { btn, clear, h, INIT, rpc } from './lib';

interface Status {
  provider: string;
  model: string;
  account?: string;
  connected: boolean;
}
const app = document.getElementById('app')!;
const status = h('p');
const error = h('p', { role: 'alert', style: 'color:var(--vscode-errorForeground)' });
const prompt = h('textarea.textarea', {
  id: 'ai-prompt',
  rows: 5,
  placeholder: 'e.g. Show the 10 customers with the highest order total this month',
  maxlength: 10000,
  style: 'width:100%;resize:vertical',
});
const preview = h('pre', { tabindex: 0, style: 'white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:var(--vscode-textCodeBlock-background)' });
const tables = h('div', { style: 'display:flex;flex-direction:column;gap:8px;max-height:220px;overflow:auto;padding:12px 0' });
const selected = new Set<number>();
for (const object of INIT.objects as { index: number; label: string; selected: boolean }[]) {
  const input = h('input', {
    type: 'checkbox',
    checked: object.selected,
    onChange: () => {
      if (input.checked) selected.add(object.index);
      else selected.delete(object.index);
    },
  });
  if (object.selected) selected.add(object.index);
  tables.append(h('label', { style: 'display:flex;gap:8px;align-items:center' }, input, object.label));
}
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
      error.textContent = 'Describe your query and choose at least one table.';
      return;
    }
    busy = true;
    generate.disabled = true;
    cancel.disabled = false;
    insert.disabled = true;
    controls.forEach((b) => (b.disabled = true));
    error.textContent = '';
    preview.textContent = 'Generating…';
    try {
      preview.textContent = await rpc<string>('generate', { prompt: prompt.value, tables: [...selected] });
      insert.disabled = false;
    } catch (e) {
      preview.textContent = '';
      error.textContent = (e as Error).message;
    } finally {
      busy = false;
      generate.disabled = false;
      cancel.disabled = true;
      controls.forEach((b) => (b.disabled = false));
    }
  },
});
function renderStatus(value: Status) {
  connected = value.connected && !!value.model;
  status.textContent = `${value.provider}${value.account ? ` · ${value.account}` : ''} · ${value.model || 'Choose a model'} · ${value.connected ? 'Connected' : 'Disconnected'}`;
  usage.hidden = value.provider !== 'chatgpt';
}
clear(
  app,
  h(
    'main',
    { style: 'max-width:900px;margin:24px auto;padding:0 24px;display:flex;flex-direction:column;gap:12px' },
    h('h1', null, 'AI Query'),
    h('p', null, `${INIT.connection} › ${INIT.database} · ${INIT.dialect}`),
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }, configure, signIn, model, disconnect, usage, agents),
    status,
    h(
      'p',
      null,
      'Your request and the selected table names, column names and types go directly to your provider. Row data and database credentials are never included. Your provider handles the request under its own data policy. Credentials stay in your editor. DBDeck has no backend.',
    ),
    h('details', { open: true }, h('summary', null, 'Schema context · choose up to 50 tables'), tables),
    h('label', { for: 'ai-prompt' }, 'Describe your query'),
    prompt,
    h('div', { style: 'display:flex;gap:8px' }, generate, cancel),
    error,
    h('h2', null, 'Query preview'),
    preview,
    h('p', null, 'Review the generated SQL before running it. Opening the query editor does not execute it.'),
    insert,
  ),
);
void action('status');
