import { Grid, GridColumn } from './grid';
import { jsonView } from './json';
import {
  btn,
  clear,
  contextMenu,
  fmtMs,
  fmtNum,
  h,
  icon,
  INIT,
  jsonEditor,
  loading,
  MenuItem,
  modal,
  raw,
  rpc,
  toast,
  toCsv,
  toObjects,
  toTsv,
} from './lib';

interface Init {
  mode: 'sql' | 'mongo' | 'es';
  title: string;
  location: string;
  pageSize: number;
  editable: boolean;
  dialect?: 'mysql' | 'postgres' | 'clickhouse';
}

const I = INIT as Init;
const app = document.getElementById('app')!;
const isSql = I.mode === 'sql';

let page = 0;
let pageSize = I.pageSize;
let total: number | undefined;
let columns: GridColumn[] = [];
let rows: unknown[][] = [];
let docs: Record<string, unknown>[] = [];
let duration = 0;
let view: 'grid' | 'json' = 'grid';
let loadSeq = 0;

const edits = new Map<number, Map<number, unknown>>();
const originals = new Map<number, unknown[]>();
const added = new Set<number>();
const deleted = new Set<number>();

const pkCols = () => columns.map((c, i) => (c.pk ? i : -1)).filter((i) => i >= 0);
const canEditRows = () => I.editable && isSql && pkCols().length > 0;
const dirty = () => edits.size > 0 || added.size > 0 || deleted.size > 0;

const quote = (n: string) => (I.dialect === 'postgres' ? `"${n.replace(/"/g, '""')}"` : `\`${n.replace(/`/g, '``')}\``);
const sqlLiteral = (v: unknown) =>
  v === null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/'/g, "''")}'`;

const inputs = {
  a: h('input.input.mono', { placeholder: isSql ? "id > 10 AND status = 'active'" : I.mode === 'mongo' ? '{ "status": "active" }' : 'status:active AND age:>30  or  { "match": { ... } }' }) as HTMLInputElement,
  b: h('input.input.mono', { placeholder: isSql ? 'created_at DESC' : I.mode === 'mongo' ? '{ "_id": -1 }' : '@timestamp desc' }) as HTMLInputElement,
  c: h('input.input.mono', { placeholder: '{ "name": 1 }' }) as HTMLInputElement,
};

const grid = new Grid({
  sort: 'server',
  editable: canEditRows,
  rowOffset: () => page * pageSize,
  onSort: (c, dir) => {
    const name = columns[c].name;
    if (isSql) inputs.b.value = dir ? `${quote(name)} ${dir.toUpperCase()}` : '';
    else if (I.mode === 'mongo') inputs.b.value = dir ? JSON.stringify({ [name]: dir === 'asc' ? 1 : -1 }) : '';
    else inputs.b.value = dir ? `${name} ${dir}` : '';
    void load(true);
  },
  onEdit: (r, c, value) => setCell(r, c, value),
  onActivate: (r, c) => (isSql ? viewValue(columns[c].name, rows[r][c]) : I.editable ? editDoc(r) : viewValue('Document', docs[r])),
  onContextMenu: (e, r, c) => contextMenu(e.clientX, e.clientY, menuFor(r, c)),
  onSelect: () => updateFooter(),
  onKey: (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && (canEditRows() || (!isSql && I.editable))) {
      e.preventDefault();
      void deleteSelected();
      return true;
    }
    return false;
  },
  rowClass: (r) => (deleted.has(r) ? 'deleted' : added.has(r) ? 'added' : ''),
  cellClass: (r, c) => (edits.get(r)?.has(c) ? 'dirty' : ''),
});

function setCell(r: number, c: number, value: unknown): void {
  if (!added.has(r) && !originals.has(r)) originals.set(r, rows[r].slice());
  rows[r][c] = value;
  if (!added.has(r)) {
    const orig = originals.get(r)![c];
    const m = edits.get(r) ?? new Map<number, unknown>();
    const same = orig === value || (orig !== null && typeof orig === 'object' && JSON.stringify(orig) === value) || (orig !== null && String(orig) === value);
    if (same) m.delete(c);
    else m.set(c, value);
    if (m.size) edits.set(r, m);
    else edits.delete(r);
  }
  grid.refresh();
  updateFooter();
}

const sideHead = h('div.sp-head');
const sideBody = h('div.sp-body');
const side = h('div.side-panel.hidden', null, sideHead, sideBody);

function viewValue(name: string, v: unknown): void {
  let parsed = v;
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
  clear(sideBody, parsed !== null && typeof parsed === 'object' ? jsonView(parsed, 3) : h('pre', null, v === null ? 'NULL' : v === undefined ? '' : String(v)));
}

function menuFor(r: number, c: number): MenuItem[] {
  const col = columns[c]?.name;
  const v = rows[r]?.[c];
  const sel = grid.selectedRows();
  const items: MenuItem[] = [
    { label: 'Copy value', icon: 'copy', action: () => rpc('copy', { text: raw(v) }) },
    { label: `Copy ${sel.length > 1 ? `${sel.length} rows` : 'row'}`, icon: 'files', action: () => rpc('copy', { text: toTsv(sel.map((i) => rows[i])) }) },
    {
      label: 'Copy as JSON',
      icon: 'json',
      action: () => rpc('copy', { text: JSON.stringify(isSql ? toObjects(columns.map((x) => x.name), sel.map((i) => rows[i])) : sel.map((i) => docs[i]), null, 2) }),
    },
  ];
  if (isSql)
    items.push({
      label: 'Copy as INSERT',
      icon: 'code',
      action: async () => rpc('copy', { text: await rpc('insertSql', { columns: columns.map((x) => x.name), rows: sel.map((i) => rows[i]) }) }).then(() => toast('INSERT statements copied')),
    });
  items.push('-', {
    label: `Filter by ${col} = ${v === null ? 'NULL' : 'this value'}`,
    icon: 'filter',
    action: () => {
      if (isSql) inputs.a.value = v === null ? `${quote(col)} IS NULL` : `${quote(col)} = ${sqlLiteral(v)}`;
      else if (I.mode === 'mongo') inputs.a.value = JSON.stringify({ [col]: v });
      else inputs.a.value = `${col}:${JSON.stringify(v)}`;
      void load(true);
    },
  });
  if (canEditRows()) {
    items.push(
      '-',
      { label: 'Edit cell', icon: 'edit', action: () => grid.startEdit(rowsView(r), c) },
      { label: 'Set NULL', icon: 'circle-slash', action: () => setCell(r, c, null) },
      { label: deleted.has(r) ? 'Restore row(s)' : 'Delete row(s)', icon: 'trash', danger: !deleted.has(r), action: () => void deleteSelected() },
    );
  }
  if (!isSql && I.editable) {
    items.push(
      '-',
      { label: 'Edit document', icon: 'edit', action: () => editDoc(r) },
      { label: 'Clone document', icon: 'copy', action: () => insertDoc(docs[r]) },
      { label: `Delete ${sel.length > 1 ? `${sel.length} documents` : 'document'}`, icon: 'trash', danger: true, action: () => void deleteSelected() },
    );
  }
  items.push('-', { label: 'View value', icon: 'eye', action: () => viewValue(col, v) });
  return items;
}

function rowsView(r: number): number {
  return grid.visibleRows().indexOf(rows[r]);
}

function editDoc(r: number): void {
  const doc = docs[r];
  const ta = jsonEditor(JSON.stringify(doc, null, 2), 22);
  modal(`Edit document`, ta, [
    { label: 'Cancel' },
    {
      label: 'Save',
      primary: true,
      onClick: async () => {
        JSON.parse(ta.value);
        await rpc('replace', { id: doc._id, text: ta.value });
        toast('Document saved', 'success');
        void load();
      },
    },
  ], { icon: 'edit', wide: true });
}

function insertDoc(template?: Record<string, unknown>): void {
  const base = template ? { ...template } : {};
  delete base._id;
  const ta = jsonEditor(JSON.stringify(base, null, 2) === '{}' ? (I.mode === 'es' ? '{\n  "_id": "",\n  \n}' : '{\n  \n}') : JSON.stringify(base, null, 2), 22);
  modal(
    I.mode === 'mongo' ? 'Insert document(s)' : 'Index document',
    h('div.col', null, ta, h('div.muted', { style: 'font-size:11.5px' }, I.mode === 'mongo' ? 'Extended JSON. Paste an array to insert many documents.' : 'Leave out "_id" to let Elasticsearch generate one.')),
    [
      { label: 'Cancel' },
      {
        label: 'Insert',
        primary: true,
        onClick: async () => {
          const parsed = JSON.parse(ta.value);
          if (I.mode === 'es' && parsed._id === '') delete parsed._id;
          await rpc('insert', { text: JSON.stringify(parsed) });
          toast('Inserted', 'success');
          void load();
        },
      },
    ],
    { icon: 'add', wide: true },
  );
}

async function deleteSelected(): Promise<void> {
  const sel = grid.selectedRows();
  if (!sel.length) return;
  if (isSql) {
    const restore = sel.every((r) => deleted.has(r));
    sel.forEach((r) => (restore ? deleted.delete(r) : deleted.add(r)));
    grid.refresh();
    updateFooter();
    return;
  }
  const ok = await rpc<boolean>('confirm', { message: `Delete ${sel.length} document(s)?`, action: 'Delete' });
  if (!ok) return;
  try {
    const n = await rpc<number>('remove', { ids: sel.map((r) => docs[r]._id) });
    toast(`Deleted ${n} document(s)`, 'success');
    void load();
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

function addRow(): void {
  const r = rows.length;
  rows.push(columns.map(() => undefined));
  added.add(r);
  grid.setData(columns, rows, true);
  grid.scrollToRow(r);
  const first = columns.findIndex((c) => !/auto_increment|nextval|identity/i.test(`${c.type ?? ''}`));
  grid.startEdit(grid.viewCount - 1, Math.max(0, first));
  updateFooter();
}

async function save(): Promise<void> {
  if (!dirty()) return;
  const pks = pkCols();
  const keyOf = (r: number) => Object.fromEntries(pks.map((c) => [columns[c].name, (originals.get(r) ?? rows[r])[c]]));
  const changes = {
    updates: [...edits].filter(([r]) => !deleted.has(r)).map(([r, m]) => ({ key: keyOf(r), values: Object.fromEntries([...m].map(([c, v]) => [columns[c].name, v])) })),
    inserts: [...added].filter((r) => !deleted.has(r)).map((r) => Object.fromEntries(columns.map((c, i) => [c.name, rows[r][i]]).filter(([, v]) => v !== undefined))),
    deletes: [...deleted].filter((r) => !added.has(r)).map(keyOf),
  };
  loading(app, true);
  try {
    const n = await rpc<number>('apply', changes);
    toast(`Saved · ${n} row(s) affected`, 'success');
    await load();
  } catch (e) {
    loading(app, false);
    modal('Save failed', h('div.message.error', { style: 'margin:0' }, (e as Error).message), [{ label: 'OK', primary: true }], { icon: 'error' });
  }
}

function discard(): void {
  for (const [r, orig] of originals) rows[r] = orig;
  const keep = rows.filter((_, i) => !added.has(i));
  rows = keep;
  edits.clear();
  originals.clear();
  added.clear();
  deleted.clear();
  grid.setData(columns, rows, true);
  updateFooter();
}

function params(): Record<string, unknown> {
  if (isSql) return { limit: pageSize, offset: page * pageSize, where: inputs.a.value, orderBy: inputs.b.value };
  if (I.mode === 'mongo') return { filter: inputs.a.value, sort: inputs.b.value, projection: inputs.c.value, skip: page * pageSize, limit: pageSize };
  return { query: inputs.a.value, sort: inputs.b.value, from: page * pageSize, size: pageSize };
}

async function load(resetPage = false): Promise<void> {
  if (dirty()) {
    const ok = await rpc<boolean>('confirm', { message: 'Discard unsaved changes?', action: 'Discard' });
    if (!ok) return;
  }
  if (resetPage) {
    page = 0;
    total = undefined;
  }
  const seq = ++loadSeq;
  loading(app, true);
  try {
    const p = params();
    const r = await rpc<{ columns: GridColumn[]; rows: unknown[][]; docs?: Record<string, unknown>[]; durationMs: number; total?: number }>('load', p);
    if (seq !== loadSeq) return;
    edits.clear();
    originals.clear();
    added.clear();
    deleted.clear();
    columns = r.columns;
    rows = r.rows;
    docs = r.docs ?? [];
    duration = r.durationMs;
    if (r.total !== undefined) total = r.total;
    errorBox.classList.add('hidden');
    grid.emptyText = inputs.a.value ? 'No rows match the filter' : 'Empty';
    grid.setData(columns, rows, true);
    renderBody();
    if (isSql || I.mode === 'mongo') {
      if (resetPage || total === undefined) {
        total = undefined;
        rpc<number>('count', isSql ? { where: inputs.a.value } : { filter: inputs.a.value })
          .then((n) => {
            if (seq === loadSeq) {
              total = n;
              updateFooter();
            }
          })
          .catch(() => undefined);
      }
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    clear(errorBox, h('div.head', null, icon('error'), 'Query failed'), (e as Error).message);
    errorBox.classList.remove('hidden');
  } finally {
    if (seq === loadSeq) loading(app, false);
    updateFooter();
  }
}

const errorBox = h('div.message.error.hidden');
const content = h('div.split');
const footer = h('div.footer');

function renderBody(): void {
  if (view === 'json' && !isSql) clear(content, h('div.scroll', null, jsonView(docs, 1)), side);
  else clear(content, h('div.grid-wrap', null, grid.el), side);
}

function updateFooter(): void {
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
  const from = rows.length ? page * pageSize + 1 : 0;
  const to = page * pageSize + rows.filter((_, i) => !added.has(i)).length;
  const sel = grid.selectedRows().length;
  const pendingCount = edits.size + added.size + deleted.size;
  const sizeSel = h(
    'select.select',
    { style: 'height:24px;padding:0 4px;font-size:12px', title: 'Rows per page' },
    [25, 50, 100, 200, 500, 1000].map((n) => h('option', { value: String(n), selected: n === pageSize }, `${n} / page`)),
  ) as HTMLSelectElement;
  sizeSel.addEventListener('change', () => {
    pageSize = Number(sizeSel.value);
    void load(true);
  });
  const left: (HTMLElement | null)[] = [];
  if (isSql && I.editable && pkCols().length) {
    left.push(
      btn('Add row', { icon: 'add', class: 'sm', onClick: addRow }),
      btn('Delete', { icon: 'trash', class: 'sm', disabled: !sel, onClick: () => void deleteSelected() }),
    );
    if (pendingCount) {
      left.push(
        h('div.sep'),
        h('span.badge.warn', null, icon('circle-filled'), `${pendingCount} pending`),
        btn('Save', { icon: 'save', class: 'sm primary', title: 'Save changes (⌘S)', onClick: () => void save() }),
        btn('Discard', { icon: 'discard', class: 'sm ghost', onClick: discard }),
      );
    }
  } else if (isSql && I.editable && columns.length) {
    left.push(h('span.badge', { title: 'Rows can only be edited when the table has a primary key' }, icon('lock'), 'No primary key · read only'));
  } else if (isSql && !I.editable) {
    left.push(h('span.badge', null, icon('lock'), 'Read only'));
  }
  if (!isSql) {
    left.push(
      h(
        'div.btn-group',
        null,
        btn(null, { icon: 'table', class: `sm ${view === 'grid' ? 'active' : ''}`, title: 'Table view', onClick: () => ((view = 'grid'), renderBody(), updateFooter()) }),
        btn(null, { icon: 'json', class: `sm ${view === 'json' ? 'active' : ''}`, title: 'JSON view', onClick: () => ((view = 'json'), renderBody(), updateFooter()) }),
      ),
    );
    if (I.editable) {
      left.push(
        btn(I.mode === 'mongo' ? 'Insert' : 'Add', { icon: 'add', class: 'sm', onClick: () => insertDoc() }),
        btn('Edit', { icon: 'edit', class: 'sm', disabled: sel !== 1, onClick: () => editDoc(grid.selectedRows()[0]) }),
        btn('Delete', { icon: 'trash', class: 'sm', disabled: !sel, onClick: () => void deleteSelected() }),
      );
    }
  }
  clear(
    footer,
    left,
    h('div.grow'),
    sel > 1 ? h('span.muted', null, `${sel} selected`) : null,
    h('span.muted', { style: 'font-variant-numeric:tabular-nums' }, rows.length ? `${fmtNum(from)}–${fmtNum(to)}${total !== undefined ? ` of ${fmtNum(total)}` : ''}` : total === 0 ? '0 rows' : ''),
    h('span.badge', null, icon('clock'), fmtMs(duration)),
    sizeSel,
    h(
      'div.pager',
      null,
      btn(null, { icon: 'chevron-left', class: 'sm ghost', title: 'Previous page', disabled: page === 0, onClick: () => go(page - 1) }),
      h('span.page.muted', null, `${page + 1}${pages ? ` / ${fmtNum(pages)}` : ''}`),
      btn(null, {
        icon: 'chevron-right',
        class: 'sm ghost',
        title: 'Next page',
        disabled: pages !== undefined ? page + 1 >= pages : rows.length < pageSize,
        onClick: () => go(page + 1),
      }),
      pages ? btn(null, { icon: 'debug-step-over', class: 'sm ghost', title: 'Last page', disabled: page + 1 >= pages, onClick: () => go(pages - 1) }) : null,
    ),
  );
}

function go(p: number): void {
  page = Math.max(0, p);
  void load();
}

function filterField(tag: string, input: HTMLInputElement, width: string, w = 70): HTMLElement {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void load(true);
  });
  return h('div.input-wrap', { style: `flex:${width};--tag-w:${w}px` }, h('span.tag', null, tag), input);
}

async function exportData(kind: 'csv' | 'json'): Promise<void> {
  const name = `${I.title}-${new Date().toISOString().slice(0, 10)}.${kind}`;
  const content =
    kind === 'csv' ? toCsv(columns.map((c) => c.name), rows) : JSON.stringify(isSql ? toObjects(columns.map((c) => c.name), rows) : docs, null, 2);
  const path = await rpc<string | undefined>('saveFile', { name, content });
  if (path) toast(`Exported ${rows.length} rows to ${path}`, 'success');
}

function render(): void {
  const stats = h('span.badge');
  const statsLoader = isSql ? null : rpc<string>('stats').then((s) => (stats.textContent = s)).catch(() => stats.remove());
  void statsLoader;
  const filters = isSql
    ? [filterField('WHERE', inputs.a, '3'), filterField('ORDER BY', inputs.b, '1.3', 82)]
    : I.mode === 'mongo'
      ? [filterField('FILTER', inputs.a, '3'), filterField('SORT', inputs.b, '1.2', 56), filterField('PROJECT', inputs.c, '1.2', 72)]
      : [filterField('QUERY', inputs.a, '3', 62), filterField('SORT', inputs.b, '1.2', 56)];
  clear(
    app,
    h(
      'div.header',
      null,
      h('div.type-icon', null, icon(isSql ? 'table' : I.mode === 'mongo' ? 'symbol-array' : 'symbol-file')),
      h('div.col.grow', { style: 'gap:1px' }, h('div.title', null, I.title), h('div.crumb', null, I.location)),
      isSql ? null : stats,
      isSql ? btn('DDL', { icon: 'code', class: 'sm ghost', title: 'Show CREATE statement', onClick: async () => rpc('openInEditor', { content: await rpc('ddl'), language: 'sql' }) }) : null,
      I.mode === 'es' ? btn('Mapping', { icon: 'symbol-structure', class: 'sm ghost', onClick: async () => rpc('openInEditor', { content: await rpc('mapping'), language: 'json' }) }) : null,
      btn('CSV', { icon: 'export', class: 'sm ghost', title: 'Export current page as CSV', onClick: () => void exportData('csv') }),
      btn('JSON', { icon: 'export', class: 'sm ghost', title: 'Export current page as JSON', onClick: () => void exportData('json') }),
      btn(null, { icon: 'refresh', class: 'sm', title: 'Refresh (F5)', onClick: () => void load() }),
    ),
    h(
      'div.toolbar',
      null,
      filters,
      btn('Apply', { icon: 'filter', class: 'sm primary', onClick: () => void load(true) }),
      btn(null, {
        icon: 'clear-all',
        class: 'sm ghost',
        title: 'Clear filters',
        onClick: () => {
          inputs.a.value = inputs.b.value = inputs.c.value = '';
          grid.setSortIndicator(-1, null);
          void load(true);
        },
      }),
    ),
    errorBox,
    content,
    footer,
  );
  renderBody();
}

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void save();
  } else if (e.key === 'F5' || (mod && e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    void load();
  }
});

render();
void load(true);
