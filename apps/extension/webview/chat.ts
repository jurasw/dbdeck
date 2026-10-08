import { btn, clear, display, fmtMs, h, icon, INIT, onMessage, rpc } from './lib';

interface Status {
  provider: string;
  model: string;
  account?: string;
  connected: boolean;
}

interface ResultTable {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  durationMs: number;
}

interface ToolEvent {
  name: string;
  label: string;
  sql?: string;
  result?: ResultTable;
  error?: string;
}

const SQL_LANGUAGES = new Set([
  '',
  'sql',
  'pgsql',
  'postgresql',
  'mysql',
  'sqlite',
  'clickhouse',
  'bigquery',
  'snowflake',
  'oracle',
  'd1',
  'mssql',
  'tsql',
  'cassandra',
  'cql',
  'dynamodb',
  'partiql',
]);

const CODE_LANGUAGES: Record<string, Set<string>> = {
  sql: SQL_LANGUAGES,
  mongo: new Set(['', 'javascript', 'js', 'mongodb', 'mongo', 'mongosh']),
  es: new Set(['', 'es', 'http', 'elasticsearch', 'console']),
};
const codeLanguages = CODE_LANGUAGES[String(INIT.family ?? 'sql')] ?? SQL_LANGUAGES;
const runnable = INIT.family !== 'mongo';

document.body.classList.add('chat-page');
const app = document.getElementById('app')!;
const log = h('div.chat-log', { role: 'log', 'aria-live': 'polite' });
const error = h('p.chat-alert', { role: 'alert' });
const providerChip = h('button.chat-provider', { type: 'button', title: 'AI settings', onClick: () => toggleSettings() });
const statusText = h('p');
const input = h('textarea.chat-input', {
  id: 'chat-input',
  rows: 1,
  maxlength: 10000,
  placeholder: 'Ask a question about your data',
  'aria-label': 'Message',
});
let busy = false;
let connected = false;
let steps: HTMLElement | undefined;
let focus: string | undefined = INIT.focus;

function inline(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined ? h('code', null, m[1]) : h('strong', null, m[2]));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function prose(text: string): HTMLElement[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
        const ordered = /^\s*\d+\./.test(lines[0]);
        return h(
          ordered ? 'ol' : 'ul',
          null,
          lines.map((l) => h('li', null, inline(l.replace(/^\s*([-*]|\d+\.)\s+/, '')))),
        );
      }
      const heading = /^#{1,6}\s+(.*)$/.exec(block);
      if (heading && lines.length === 1) return h('p.chat-heading', null, inline(heading[1]));
      return h(
        'p',
        null,
        lines.flatMap((l, i) => (i ? [h('br'), ...inline(l)] : inline(l))),
      );
    });
}

function table(result: ResultTable): HTMLElement {
  const note = `${result.rows.length}${result.truncated ? '+' : ''} row${result.rows.length === 1 ? '' : 's'} · ${fmtMs(result.durationMs)}`;
  if (!result.columns.length) return h('div.chat-table-note', null, note);
  return h(
    'div.chat-result',
    null,
    h(
      'div.chat-table',
      null,
      h(
        'table',
        null,
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            result.columns.map((c) => h('th', null, c)),
          ),
        ),
        h(
          'tbody',
          null,
          result.rows.map((row) =>
            h(
              'tr',
              null,
              row.map((v) => h('td', { class: v === null ? 'null' : undefined, title: display(v, 2000) }, display(v, 120))),
            ),
          ),
        ),
      ),
    ),
    h('div.chat-table-note', null, note, result.truncated ? ' · first rows only' : ''),
  );
}

function codeBlock(language: string, code: string): HTMLElement {
  const output = h('div.chat-code-output');
  const isQuery = codeLanguages.has(language.toLowerCase());
  const run = btn('Run', {
    icon: 'play',
    class: 'sm ghost',
    title: 'Run read-only here. Results stay in this panel.',
    onClick: async () => {
      run.disabled = true;
      clear(output, h('div.chat-table-note', null, 'Running…'));
      try {
        clear(output, table(await rpc<ResultTable>('run', { sql: code })));
      } catch (e) {
        clear(output, h('div.chat-error', null, (e as Error).message));
      } finally {
        run.disabled = false;
      }
    },
  });
  const copy = btn(null, {
    icon: 'copy',
    class: 'sm ghost',
    title: 'Copy',
    onClick: () => {
      void navigator.clipboard.writeText(code);
      copy.replaceChildren(icon('check'));
      setTimeout(() => copy.replaceChildren(icon('copy')), 1200);
    },
  });
  return h(
    'div.chat-code',
    null,
    h(
      'div.chat-code-head',
      null,
      h('span', null, language || 'code'),
      h(
        'div.chat-code-actions',
        null,
        copy,
        isQuery
          ? btn(null, {
              icon: 'go-to-file',
              class: 'sm ghost',
              title: 'Open in query editor',
              onClick: () => {
                void rpc('open', { sql: code }).catch((e: Error) => (error.textContent = e.message));
              },
            })
          : null,
        isQuery && runnable ? run : null,
      ),
    ),
    h('pre', null, code),
    output,
  );
}

function markdown(text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  const fence = /```([\w-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (const m of text.matchAll(fence)) {
    out.push(...prose(text.slice(last, m.index)));
    out.push(codeBlock(m[1], m[2].replace(/\n$/, '')));
    last = m.index! + m[0].length;
  }
  out.push(...prose(text.slice(last)));
  out.forEach((el, i) => el.style.setProperty('--i', String(i)));
  return out;
}

function scroll() {
  log.scrollTo({ top: log.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function add(el: HTMLElement) {
  log.append(el);
  scroll();
  return el;
}

onMessage('chat:event', ({ event }: { event: ToolEvent }) => {
  if (!steps) return;
  steps.append(
    h(
      'details.chat-step',
      { open: event.result || event.error ? true : undefined },
      h('summary', null, icon(event.error ? 'error' : event.name === 'run_query' ? 'play' : event.name === 'list_tables' ? 'list-flat' : 'symbol-field'), event.label),
      event.sql ? h('pre', null, event.sql) : null,
      event.error ? h('div.chat-error', null, event.error) : null,
      event.result ? table(event.result) : null,
    ),
  );
  scroll();
});

onMessage('chat:focus', ({ table: name }: { table?: string }) => {
  if (name === focus) return;
  focus = name;
  if (name) add(h('div.chat-note', null, icon('table'), `Now looking at ${name}`));
});

const send = h('button.chat-send', {
  type: 'button',
  title: 'Send (Enter)',
  'aria-label': 'Send',
  onClick: () => {
    if (busy) void rpc('cancel');
    else void submit();
  },
});

function setBusy(on: boolean) {
  busy = on;
  send.classList.toggle('stop', on);
  send.title = on ? 'Stop' : 'Send (Enter)';
  send.setAttribute('aria-label', on ? 'Stop' : 'Send');
  send.replaceChildren(icon(on ? 'debug-stop' : 'arrow-up'));
  headerOrb.classList.toggle('busy', on);
}

function grow() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
}

async function submit(text = input.value) {
  if (busy || !text.trim()) return;
  if (!connected) {
    error.textContent = 'Connect an AI provider and choose a model first.';
    settings.hidden = false;
    return;
  }
  error.textContent = '';
  setBusy(true);
  input.value = '';
  grow();
  document.querySelectorAll('.chat-suggestions').forEach((el) => el.remove());
  add(h('div.chat-msg.user', null, h('div.chat-bubble', null, text.trim())));
  steps = h('div.chat-steps');
  const thinking = h('div.chat-thinking', null, h('span.chat-shimmer', null, 'Thinking'));
  const answer = add(h('div.chat-msg.assistant', null, steps, thinking));
  try {
    const reply = await rpc<string>('send', { text });
    thinking.remove();
    answer.append(h('div.chat-answer', null, markdown(reply)));
  } catch (e) {
    thinking.remove();
    answer.append(h('div.chat-error', null, (e as Error).message));
  } finally {
    steps = undefined;
    setBusy(false);
    scroll();
    input.focus();
  }
}

input.addEventListener('input', grow);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void submit();
  }
});

const queries = h('input', {
  type: 'checkbox',
  id: 'chat-queries',
  checked: !!INIT.queries,
  onChange: async () => {
    const wanted = queries.checked;
    queries.disabled = true;
    try {
      queries.checked = await rpc<boolean>('queries', { on: wanted });
    } catch (e) {
      queries.checked = !wanted;
      error.textContent = (e as Error).message;
    } finally {
      queries.disabled = false;
    }
  },
}) as HTMLInputElement;

const controls: HTMLButtonElement[] = [];
async function action(method: string) {
  error.textContent = '';
  controls.forEach((b) => (b.disabled = true));
  try {
    renderStatus(await rpc<Status>(method));
  } catch (e) {
    error.textContent = (e as Error).message;
  } finally {
    controls.forEach((b) => (b.disabled = false));
  }
}
const configure = btn('AI provider', { icon: 'settings-gear', class: 'sm', onClick: () => void action('configure') });
const model = btn('Choose model', { class: 'sm', onClick: () => void action('model') });
const signIn = btn('Continue with ChatGPT', { class: 'sm', onClick: () => void action('signIn') });
const disconnect = btn('Disconnect', { class: 'sm', onClick: () => void action('disconnect') });
const usage = btn('ChatGPT usage', { class: 'sm', onClick: () => void rpc('usage') });
controls.push(configure, model, signIn, disconnect);

const settings = h(
  'section.chat-settings',
  null,
  statusText,
  h('div.chat-row', null, configure, model, signIn, disconnect, usage),
  h(
    'p.chat-muted',
    null,
    'Messages and the table and column names the assistant reads go directly to your provider. With read-only queries on, query results go there too. Credentials stay in your editor. DBDeck has no backend.',
  ),
);
settings.hidden = true;

function toggleSettings() {
  settings.hidden = !settings.hidden;
}

function renderStatus(value: Status) {
  connected = value.connected && !!value.model;
  providerChip.replaceChildren(h('span.chat-dot', { class: connected ? 'on' : undefined }), `${value.provider} · ${value.model || 'choose a model'}`);
  statusText.textContent = `${value.provider}${value.account ? ` · ${value.account}` : ''} · ${value.model || 'Choose a model'} · ${value.connected ? 'Connected' : 'Disconnected'}`;
  usage.hidden = value.provider !== 'chatgpt';
  signIn.hidden = value.provider !== 'chatgpt';
  signIn.textContent = value.connected ? 'Switch ChatGPT account' : 'Continue with ChatGPT';
  disconnect.hidden = !value.connected || value.provider === 'ollama';
  if (!connected) settings.hidden = false;
}

function suggestions(): string[] {
  return focus
    ? [`What does ${focus} store?`, `Show the 10 most recent rows of ${focus}`, `Which tables are related to ${focus}?`]
    : ['Which tables are in this database and what do they store?', 'How are the main tables related?', 'Which table has the most rows?'];
}

function greeting(): HTMLElement {
  const where = [INIT.location || INIT.connection, focus && `the ${focus} table you have open`].filter(Boolean).join(' and ');
  return h(
    'div.chat-msg.assistant.chat-greeting',
    null,
    h(
      'div.chat-answer',
      null,
      h(
        'p',
        null,
        `Hi, ask me anything about ${where}. I read the schema myself`,
        queries.checked ? ' and run read-only queries to check the data.' : '. Turn on read-only queries below to let me look at the data too.',
        ' I can make mistakes, so check the SQL before you run it.',
      ),
    ),
    h(
      'div.chat-suggestions',
      null,
      suggestions().map((s) =>
        h(
          'button.chat-chip',
          {
            type: 'button',
            onClick: () => {
              void submit(s);
            },
          },
          s,
        ),
      ),
    ),
  );
}

const headerOrb = h('span.chat-orb', { 'aria-hidden': 'true' }, h('span.chat-orb-core'));
clear(
  app,
  h(
    'div.chat-shell',
    null,
    h(
      'header.chat-header',
      null,
      headerOrb,
      h('div.chat-title', null, h('strong', null, 'Assistant'), h('span', null, [INIT.connection, INIT.location].filter(Boolean).join(' › '))),
      h(
        'div.chat-row',
        null,
        btn(null, {
          icon: 'add',
          class: 'sm ghost',
          title: 'New chat',
          onClick: async () => {
            await rpc('reset');
            clear(log, greeting());
            error.textContent = '';
            input.focus();
          },
        }),
        btn(null, { icon: 'settings-gear', class: 'sm ghost', title: 'AI settings', onClick: () => toggleSettings() }),
        btn('Close', { icon: 'close', class: 'sm', title: 'Close assistant', onClick: () => void rpc('close') }),
      ),
    ),
    settings,
    log,
    h(
      'footer.chat-compose',
      null,
      error,
      h('div.chat-input-box', null, input, send),
      h(
        'div.chat-meta',
        null,
        h('label.chat-toggle', { for: 'chat-queries', title: 'Query results are sent to your AI provider' }, queries, h('span', null, 'Run read-only queries')),
        providerChip,
      ),
    ),
  ),
);
setBusy(false);
log.append(greeting());
input.focus();
void action('status');
