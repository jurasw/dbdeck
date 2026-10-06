import { jsonView } from './json';
import { btn, clear, fmtNum, h, icon, INIT, jsonEditor, loading, modal, rpc, toast } from './lib';

interface KeyValue {
  key: string;
  type: string;
  ttl: number;
  size: number;
  value: any;
  truncated?: boolean;
}

const I = INIT as { key: string; db: number; location: string; readonly: boolean };
const app = document.getElementById('app')!;
let key = I.key;
let data: KeyValue | undefined;
let stringMode: 'text' | 'json' = 'text';
let filterText = '';

const TYPE_STYLE: Record<string, [string, string]> = {
  string: ['symbol-string', 'var(--vscode-charts-blue)'],
  hash: ['symbol-object', 'var(--vscode-charts-purple)'],
  list: ['list-ordered', 'var(--vscode-charts-green)'],
  set: ['symbol-array', 'var(--vscode-charts-orange)'],
  zset: ['list-filter', 'var(--vscode-charts-yellow)'],
  stream: ['pulse', 'var(--vscode-charts-red)'],
  'ReJSON-RL': ['json', 'var(--vscode-charts-blue)'],
};

async function exec(...args: (string | number)[]): Promise<any> {
  return rpc('exec', { args: args.map(String) });
}

async function run(fn: () => Promise<unknown>, ok?: string): Promise<void> {
  try {
    await fn();
    if (ok) toast(ok, 'success');
    await load();
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

async function load(): Promise<void> {
  loading(app, true);
  try {
    data = await rpc<KeyValue>('load', { key });
    render();
  } catch (e) {
    clear(app, h('div.empty', null, icon('warning'), h('div.big', null, 'Key unavailable'), (e as Error).message));
  } finally {
    loading(app, false);
  }
}

function fmtTtl(ttl: number): string {
  if (ttl === -1) return 'No expiry';
  if (ttl < 0) return 'Expired';
  const d = Math.floor(ttl / 86400);
  const hh = Math.floor((ttl % 86400) / 3600);
  const m = Math.floor((ttl % 3600) / 60);
  const s = ttl % 60;
  return [d && `${d}d`, hh && `${hh}h`, m && `${m}m`, (s || ttl < 60) && `${s}s`].filter(Boolean).join(' ');
}

function prompt(title: string, fields: { label: string; value?: string; multiline?: boolean; placeholder?: string }[], onOk: (values: string[]) => Promise<unknown>): void {
  const inputs = fields.map((f) =>
    f.multiline ? jsonEditor(f.value ?? '', 8) : (h('input.input', { value: f.value ?? '', placeholder: f.placeholder ?? '', spellcheck: 'false' }) as HTMLInputElement),
  );
  const body = h(
    'div.col',
    { style: 'gap:12px' },
    fields.map((f, i) => h('div.field', { style: 'grid-column:auto' }, h('label', null, f.label), inputs[i])),
  );
  inputs.forEach((inp) =>
    inp.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' && inp.tagName === 'INPUT') (body.closest('.modal')?.querySelector('.btn.primary') as HTMLElement)?.click();
    }),
  );
  modal(title, body, [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => onOk(inputs.map((i) => i.value)) }], { icon: 'edit' });
}

function renderHeader(d: KeyValue): HTMLElement {
  const [ic, color] = TYPE_STYLE[d.type] ?? ['key', 'var(--fg)'];
  const ttl = h(
    'span.badge.ttl-chip',
    {
      class: d.ttl >= 0 ? 'warn' : '',
      title: 'Click to change TTL',
      onClick: () =>
        I.readonly ||
        prompt('Time to live', [{ label: 'TTL in seconds (empty or -1 = never expire)', value: d.ttl >= 0 ? String(d.ttl) : '' }], async ([v]) => {
          const n = Number(v);
          if (!v.trim() || n < 0) await exec('PERSIST', key);
          else await exec('EXPIRE', key, Math.floor(n));
          await load();
        }),
    },
    icon('watch'),
    fmtTtl(d.ttl),
  );
  return h(
    'div.header',
    null,
    h('div.type-icon', { style: `color:${color}` }, icon(ic)),
    h(
      'div.col.grow',
      { style: 'gap:2px' },
      h('div.title.mono', { title: d.key }, d.key),
      h('div.row', { style: 'gap:6px' }, h('span.badge.accent', null, d.type), ttl, h('span.badge', null, `${fmtNum(d.size)} ${d.type === 'string' ? 'chars' : 'items'}`), h('span.crumb', null, I.location)),
    ),
    btn(null, { icon: 'copy', class: 'sm ghost', title: 'Copy key name', onClick: () => rpc('copy', { text: key }).then(() => toast('Copied')) }),
    I.readonly
      ? null
      : btn('Rename', {
          icon: 'edit',
          class: 'sm ghost',
          onClick: () =>
            prompt('Rename key', [{ label: 'New name', value: key }], async ([v]) => {
              if (!v || v === key) return;
              await exec('RENAME', key, v);
              key = v;
              await load();
            }),
        }),
    btn(null, { icon: 'refresh', class: 'sm', title: 'Reload', onClick: () => void load() }),
    I.readonly
      ? null
      : btn(null, {
          icon: 'trash',
          class: 'sm danger',
          title: 'Delete key',
          onClick: async () => {
            if (await rpc('confirm', { message: `Delete key "${key}"?`, action: 'Delete' })) await exec('DEL', key);
          },
        }),
  );
}

function renderString(d: KeyValue): HTMLElement {
  const text = String(d.value ?? '');
  let parsed: unknown;
  try {
    parsed = /^\s*[[{]/.test(text) ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  const ta = jsonEditor(stringMode === 'json' && parsed !== undefined ? JSON.stringify(parsed, null, 2) : text);
  ta.readOnly = I.readonly;
  const saveBtn = btn('Save', {
    icon: 'save',
    class: 'sm primary',
    disabled: true,
    onClick: () =>
      run(async () => {
        let v = ta.value;
        if (stringMode === 'json' && parsed !== undefined) v = JSON.stringify(JSON.parse(v));
        const args = d.ttl > 0 ? ['SET', key, v, 'KEEPTTL'] : ['SET', key, v];
        await exec(...args);
      }, 'Saved'),
  });
  ta.addEventListener('input', () => (saveBtn.disabled = false));
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveBtn.click();
    }
  });
  return h(
    'div.editor-area',
    null,
    h(
      'div.row',
      null,
      h(
        'div.btn-group',
        null,
        btn('Text', { class: `sm ${stringMode === 'text' ? 'active' : ''}`, onClick: () => ((stringMode = 'text'), render()) }),
        btn('JSON', { class: `sm ${stringMode === 'json' ? 'active' : ''}`, disabled: parsed === undefined, onClick: () => ((stringMode = 'json'), render()) }),
      ),
      h('div.grow'),
      h('span.muted', { style: 'font-size:11.5px' }, `${fmtNum(new TextEncoder().encode(text).length)} bytes`),
      btn(null, { icon: 'copy', class: 'sm ghost', title: 'Copy value', onClick: () => rpc('copy', { text }).then(() => toast('Copied')) }),
      I.readonly ? null : saveBtn,
    ),
    ta,
  );
}

type Row = { cells: (string | number)[]; edit?: () => void; remove?: () => void };

function table(headers: string[], rows: Row[], onAdd?: () => void, addLabel = 'Add'): HTMLElement {
  const filtered = filterText ? rows.filter((r) => r.cells.some((c) => String(c).toLowerCase().includes(filterText))) : rows;
  const search = h('input.input', { placeholder: 'Filter…', value: filterText, style: 'width:240px' }) as HTMLInputElement;
  search.addEventListener('input', () => {
    filterText = search.value.toLowerCase();
    const pos = search.selectionStart;
    render();
    const again = app.querySelector('.toolbar input') as HTMLInputElement | null;
    again?.focus();
    again?.setSelectionRange(pos, pos);
  });
  return h(
    'div',
    { style: 'display:flex;flex-direction:column;flex:1;min-height:0' },
    h(
      'div.toolbar',
      null,
      h('div.input-wrap', null, icon('search'), search),
      h('div.grow'),
      data?.truncated ? h('span.badge.warn', null, icon('warning'), `showing first ${fmtNum(rows.length)}`) : null,
      onAdd && !I.readonly ? btn(addLabel, { icon: 'add', class: 'sm primary', onClick: onAdd }) : null,
    ),
    h(
      'div.scroll',
      null,
      h(
        'table.kv',
        null,
        h('thead', null, h('tr', null, h('th', null, '#'), headers.map((x) => h('th', null, x)), h('th'))),
        h(
          'tbody',
          null,
          filtered.map((r, i) =>
            h(
              'tr',
              { onDblclick: () => !I.readonly && r.edit?.() },
              h('td.idx', null, String(i + 1)),
              r.cells.map((c) => h(typeof c === 'number' ? 'td.num' : 'td', null, String(c))),
              h(
                'td.act',
                null,
                btn(null, { icon: 'copy', class: 'sm ghost', title: 'Copy', onClick: () => rpc('copy', { text: String(r.cells[r.cells.length - 1]) }) }),
                !I.readonly && r.edit ? btn(null, { icon: 'edit', class: 'sm ghost', title: 'Edit', onClick: r.edit }) : null,
                !I.readonly && r.remove ? btn(null, { icon: 'trash', class: 'sm ghost', title: 'Remove', onClick: r.remove }) : null,
              ),
            ),
          ),
        ),
      ),
      filtered.length ? null : h('div.empty', { style: 'padding:30px' }, 'Nothing here'),
    ),
  );
}

function renderBody(d: KeyValue): HTMLElement {
  switch (d.type) {
    case 'string':
      return renderString(d);
    case 'hash': {
      const entries = Object.entries(d.value as Record<string, string>).sort(([a], [b]) => a.localeCompare(b));
      return table(
        ['Field', 'Value'],
        entries.map(([f, v]) => ({
          cells: [f, v],
          edit: () =>
            prompt('Edit field', [{ label: 'Field', value: f }, { label: 'Value', value: v, multiline: true }], async ([nf, nv]) => {
              if (nf !== f) await exec('HDEL', key, f);
              await exec('HSET', key, nf, nv);
              await load();
            }),
          remove: () => run(() => exec('HDEL', key, f)),
        })),
        () => prompt('Add field', [{ label: 'Field' }, { label: 'Value', multiline: true }], async ([f, v]) => (await exec('HSET', key, f, v), load())),
        'Add field',
      );
    }
    case 'list':
      return table(
        ['Value'],
        (d.value as string[]).map((v, i) => ({
          cells: [v],
          edit: () => prompt(`Edit item ${i}`, [{ label: 'Value', value: v, multiline: true }], async ([nv]) => (await exec('LSET', key, i, nv), load())),
          remove: () =>
            run(async () => {
              const marker = `__dbdeck_removed_${Date.now()}__`;
              await exec('LSET', key, i, marker);
              await exec('LREM', key, 1, marker);
            }),
        })),
        () =>
          prompt('Push item', [{ label: 'Value', multiline: true }, { label: 'Position (head / tail)', value: 'tail' }], async ([v, pos]) => {
            await exec(pos.trim().toLowerCase() === 'head' ? 'LPUSH' : 'RPUSH', key, v);
            await load();
          }),
        'Push',
      );
    case 'set':
      return table(
        ['Member'],
        (d.value as string[]).map((m) => ({
          cells: [m],
          edit: () =>
            prompt('Edit member', [{ label: 'Member', value: m, multiline: true }], async ([nm]) => {
              if (nm === m) return;
              await exec('SREM', key, m);
              await exec('SADD', key, nm);
              await load();
            }),
          remove: () => run(() => exec('SREM', key, m)),
        })),
        () => prompt('Add member', [{ label: 'Member', multiline: true }], async ([m]) => (await exec('SADD', key, m), load())),
        'Add member',
      );
    case 'zset':
      return table(
        ['Score', 'Member'],
        (d.value as { member: string; score: number }[]).map((z) => ({
          cells: [z.score, z.member],
          edit: () =>
            prompt('Edit member', [{ label: 'Score', value: String(z.score) }, { label: 'Member', value: z.member, multiline: true }], async ([s, m]) => {
              if (m !== z.member) await exec('ZREM', key, z.member);
              await exec('ZADD', key, s, m);
              await load();
            }),
          remove: () => run(() => exec('ZREM', key, z.member)),
        })),
        () => prompt('Add member', [{ label: 'Score', value: '0' }, { label: 'Member', multiline: true }], async ([s, m]) => (await exec('ZADD', key, s, m), load())),
        'Add member',
      );
    case 'stream':
      return table(
        ['ID', 'Fields'],
        (d.value as { id: string; fields: Record<string, string> }[]).map((e) => ({
          cells: [e.id, JSON.stringify(e.fields)],
          remove: () => run(() => exec('XDEL', key, e.id)),
        })),
        () =>
          prompt('Add entry', [{ label: 'Fields as JSON object', value: '{\n  "field": "value"\n}', multiline: true }], async ([json]) => {
            const obj = JSON.parse(json) as Record<string, unknown>;
            await exec('XADD', key, '*', ...Object.entries(obj).flatMap(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
            await load();
          }),
        'Add entry',
      );
    case 'ReJSON-RL': {
      let parsed: unknown = d.value;
      try {
        parsed = JSON.parse(String(d.value));
      } catch {
        parsed = d.value;
      }
      return h(
        'div.scroll',
        null,
        h(
          'div.toolbar',
          null,
          h('div.grow'),
          I.readonly
            ? null
            : btn('Edit', {
                icon: 'edit',
                class: 'sm primary',
                onClick: () =>
                  prompt('Edit JSON', [{ label: 'Value', value: JSON.stringify(parsed, null, 2), multiline: true }], async ([v]) => {
                    await exec('JSON.SET', key, '$', JSON.stringify(JSON.parse(v)));
                    await load();
                  }),
              }),
        ),
        jsonView(parsed, 3),
      );
    }
    default:
      return h('div.empty', null, `Unsupported type: ${d.type}`);
  }
}

function render(): void {
  if (!data) return;
  clear(app, renderHeader(data), renderBody(data));
}

void load();
