import { Grid } from './grid';
import { jsonView } from './json';
import { btn, clear, contextMenu, debounce, fmtMs, fmtNum, h, icon, onMessage, raw, rpc, toast, toCsv, toObjects, toTsv } from './lib';

interface Result {
  columns: { name: string; type?: string }[];
  rows: unknown[][];
  affectedRows?: number;
  message?: string;
  durationMs: number;
  sql?: string;
  error?: string;
  json?: unknown;
  truncated?: boolean;
}

const app = document.getElementById('app')!;
let results: Result[] = [];
let location = '';
let active = 0;
let mode: 'grid' | 'json' = 'grid';
let filter = '';

const grid = new Grid({
  sort: 'client',
  onContextMenu: (e, r, c) => {
    const res = results[active];
    contextMenu(e.clientX, e.clientY, [
      { label: 'Copy value', icon: 'copy', action: () => rpc('copy', { text: raw(res.rows[r][c]) }) },
      { label: 'Copy row(s)', icon: 'files', action: () => rpc('copy', { text: toTsv(grid.selectedRows().map((i) => res.rows[i])) }) },
      { label: 'Copy row(s) as JSON', icon: 'json', action: () => rpc('copy', { text: JSON.stringify(toObjects(names(res), grid.selectedRows().map((i) => res.rows[i])), null, 2) }) },
      { label: 'Copy column name', icon: 'symbol-field', action: () => rpc('copy', { text: res.columns[c].name }) },
      '-',
      { label: 'View value', icon: 'eye', action: () => viewValue(res.columns[c].name, res.rows[r][c]) },
    ]);
  },
  onActivate: (r, c) => viewValue(results[active].columns[c].name, results[active].rows[r][c]),
});

const names = (r: Result) => r.columns.map((c) => c.name);

function viewValue(name: string, v: unknown): void {
  const isObj = v !== null && typeof v === 'object';
  let parsed: unknown = v;
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try {
      parsed = JSON.parse(v);
    } catch {
      parsed = v;
    }
  }
  side.classList.remove('hidden');
  clear(
    sideHead,
    icon('eye'),
    h('span.grow', null, name),
    btn(null, { icon: 'copy', class: 'ghost sm', title: 'Copy', onClick: () => rpc('copy', { text: raw(v) }) }),
    btn(null, { icon: 'close', class: 'ghost sm', title: 'Close', onClick: () => side.classList.add('hidden') }),
  );
  clear(sideBody, isObj || typeof parsed === 'object' ? jsonView(parsed, 3) : h('pre', null, v === null ? 'NULL' : String(v)));
}

const sideHead = h('div.sp-head');
const sideBody = h('div.sp-body');
const side = h('div.side-panel.hidden', null, sideHead, sideBody);
const tabs = h('div.tabs');
const toolbar = h('div.toolbar', { style: 'padding:6px 10px' });
const body = h('div.split');
const status = h('div.footer', { style: 'min-height:30px;padding:4px 12px' });
const wrap = h('div', { style: 'position:relative;flex:1;display:flex;flex-direction:column;min-height:0' }, tabs, toolbar, body, status);

function renderEmpty(): void {
  clear(
    app,
    h(
      'div.empty',
      null,
      icon('database'),
      h('div.big', null, 'No results yet'),
      h('div', null, 'Open a query editor from the DBDeck view and press ', h('span.kbd', null, '⌘/Ctrl'), ' + ', h('span.kbd', null, 'Enter'), ' to run the statement under the cursor.'),
    ),
  );
}

function render(): void {
  clear(app, wrap);
  clear(
    tabs,
    results.map((r, i) =>
      h(
        'div.tab',
        { class: `${i === active ? 'active' : ''} ${r.error ? 'err' : ''}`, onClick: () => ((active = i), render()), title: r.sql ?? '' },
        icon(r.error ? 'error' : r.columns.length ? 'table' : r.json !== undefined ? 'json' : 'check'),
        `Result ${i + 1}`,
        r.columns.length && !r.error ? h('span.count', null, fmtNum(r.rows.length)) : null,
      ),
    ),
    h('div.grow'),
    h('div.row', { style: 'font-size:11.5px;color:var(--muted);padding-right:6px' }, icon('plug'), location),
  );
  const r = results[active];
  if (!r) return;
  const hasGrid = r.columns.length > 0;
  const hasJson = r.json !== undefined;
  if (!hasGrid && hasJson) mode = 'json';
  if (hasGrid && !hasJson) mode = 'grid';
  const searchInput = h('input.input', { placeholder: 'Filter rows…', value: filter, style: 'width:220px' }) as HTMLInputElement;
  searchInput.addEventListener(
    'input',
    debounce(() => {
      filter = searchInput.value;
      grid.setFilter(filter);
      updateStatus();
    }, 120),
  );
  const exportName = `result-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  clear(
    toolbar,
    hasGrid && hasJson
      ? h(
          'div.btn-group',
          null,
          btn('Table', { icon: 'table', class: `sm ${mode === 'grid' ? 'active' : ''}`, onClick: () => ((mode = 'grid'), render()) }),
          btn('JSON', { icon: 'json', class: `sm ${mode === 'json' ? 'active' : ''}`, onClick: () => ((mode = 'json'), render()) }),
        )
      : null,
    hasGrid && mode === 'grid' ? h('div.input-wrap', null, icon('search'), searchInput) : null,
    h('div.sql-preview.grow', { title: r.sql ?? '' }, r.sql?.replace(/\s+/g, ' ') ?? ''),
    hasGrid
      ? [
          btn(null, { icon: 'copy', class: 'ghost sm', title: 'Copy all as TSV', onClick: () => rpc('copy', { text: toTsv([names(r), ...grid.visibleRows()]) }).then(() => toast('Copied')) }),
          btn('CSV', { icon: 'export', class: 'ghost sm', title: 'Export CSV', onClick: () => save(`${exportName}.csv`, toCsv(names(r), grid.visibleRows())) }),
          btn('JSON', { icon: 'export', class: 'ghost sm', title: 'Export JSON', onClick: () => save(`${exportName}.json`, JSON.stringify(toObjects(names(r), grid.visibleRows()), null, 2)) }),
        ]
      : null,
    hasJson
      ? btn(null, { icon: 'go-to-file', class: 'ghost sm', title: 'Open JSON in editor', onClick: () => rpc('openInEditor', { content: JSON.stringify(r.json, null, 2), language: 'json' }) })
      : null,
  );
  if (r.error) {
    clear(body, h('div.scroll', null, h('div.message.error', null, h('div.head', null, icon('error'), 'Query failed'), r.error)));
  } else if (hasGrid && mode === 'grid') {
    grid.emptyText = 'Query returned no rows';
    clear(body, h('div.grid-wrap', null, grid.el), side);
    grid.setData(r.columns, r.rows);
    if (filter) grid.setFilter(filter);
  } else if (hasJson) {
    clear(body, h('div.scroll', null, r.message ? h('div.message', null, r.message) : null, jsonView(r.json, 2)));
  } else {
    clear(
      body,
      h(
        'div.scroll',
        null,
        h('div.message.ok', null, h('div.head', null, icon('pass-filled'), r.affectedRows !== undefined ? `${fmtNum(r.affectedRows)} row(s) affected` : 'Success'), r.message ?? ''),
      ),
    );
  }
  updateStatus();
}

function updateStatus(): void {
  const r = results[active];
  if (!r) return;
  const parts: (string | HTMLElement)[] = [];
  if (r.error) parts.push(h('span.badge.danger', null, icon('error'), 'Error'));
  else if (r.columns.length) {
    parts.push(h('span.badge.accent', null, icon('list-flat'), `${fmtNum(r.rows.length)} rows`));
    if (filter) parts.push(h('span.badge', null, `${fmtNum(grid.viewCount)} shown`));
    parts.push(h('span.badge', null, `${r.columns.length} columns`));
  } else parts.push(h('span.badge.ok', null, icon('check'), 'OK'));
  parts.push(h('span.badge', null, icon('clock'), fmtMs(r.durationMs)));
  if (r.truncated) parts.push(h('span.badge.warn', null, icon('warning'), 'truncated'));
  if (r.message && r.columns.length) parts.push(h('span.muted', null, r.message.split('\n')[0]));
  clear(status, parts);
}

async function save(name: string, content: string): Promise<void> {
  const path = await rpc<string | undefined>('saveFile', { name, content });
  if (path) toast(`Saved ${path}`, 'success');
}

onMessage('running', (m) => {
  location = m.location;
  if (!results.length) {
    clear(app, h('div.empty', null, h('div.spinner'), h('div', null, 'Running…'), h('div.sql-preview', { style: 'max-width:80%' }, m.label)));
    return;
  }
  wrap.querySelector('.overlay')?.remove();
  wrap.appendChild(h('div.overlay', null, h('div.col', { style: 'align-items:center' }, h('div.spinner'), h('div.muted', null, 'Running…'))));
});

onMessage('results', (m) => {
  wrap.querySelector('.overlay')?.remove();
  results = m.results;
  location = m.location;
  filter = '';
  side.classList.add('hidden');
  const firstErr = results.findIndex((r) => r.error);
  const firstGrid = results.map((r, i) => (r.columns.length ? i : -1)).filter((i) => i >= 0).pop();
  active = firstErr >= 0 ? firstErr : firstGrid ?? results.length - 1;
  mode = results[active]?.columns.length ? 'grid' : 'json';
  render();
});

renderEmpty();
void rpc('ready');
