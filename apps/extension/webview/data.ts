import { Grid, GridColumn } from './grid';
import { parseCellValue } from './cell-value';
import { duplicateRow } from './row-duplicate';
import { RowChanges, undoChanges } from './row-undo';
import { jsonView } from './json';
import {
  btn,
  clear,
  contextMenu,
  flash,
  fmtMs,
  fmtNum,
  h,
  icon,
  INIT,
  jsonEditor,
  loading,
  MenuItem,
  modal,
  onMessage,
  raw,
  rpc,
  toast,
  toCsv,
  toObjects,
  toTsv,
  typeOut,
  vscode,
} from './lib';

interface Init {
  mode: 'sql' | 'mongo' | 'es';
  title: string;
  location: string;
  pageSize: number;
  editable: boolean;
  dialect?: 'mysql' | 'postgres' | 'clickhouse' | 'bigquery' | 'snowflake';
  initialSearch?: string;
  initialData?: PageData;
}

interface HomeInit {
  mode: 'home';
  recent: { node: { label: string; table?: string }; location: string }[];
}

interface PageData {
  columns: GridColumn[];
  rows: unknown[][];
  docs?: Record<string, unknown>[];
  durationMs: number;
  total?: number;
}

const app = document.getElementById('app')!;
const scriptStart = Date.now();

function releaseWorker(): void {
  try {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        const perWebview = registrations.filter((r) => r.active && new URL(r.active.scriptURL).searchParams.has('id'));
        if (!perWebview.length) return;
        vscode.postMessage({ type: 'worker' });
        for (const r of perWebview) void r.unregister();
      })
      .catch(() => undefined);
  } catch {
    return;
  }
}
let documentTiming = true;
let pinned = false;

// Any edit, filter or navigation keeps this tab open instead of letting the next table replace it.
function pin(): void {
  if (pinned) return;
  pinned = true;
  vscode.postMessage({ type: 'pin' });
}

function reportShown(durationMs: number): void {
  const first = documentTiming;
  documentTiming = false;
  requestAnimationFrame(() =>
    setTimeout(() =>
      vscode.postMessage({
        type: 'timing',
        documentStart: first ? performance.timeOrigin : undefined,
        script: first ? scriptStart : undefined,
        shown: Date.now(),
        durationMs,
      }),
    ),
  );
}

function mount(I: Init): { save: () => Promise<void>; load: () => Promise<void>; dispose: () => void } {
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
  let loaded = false;
  const searchStatus = h('span.data-search-status', { role: 'status' }, icon('search'));
  const searchInput = h('input.input', { placeholder: 'Search all values…', 'aria-label': 'Search all values' }) as HTMLInputElement;
  searchInput.value = I.initialSearch ?? '';
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void load(true);
    }
  });

  const edits = new Map<number, Map<number, unknown>>();
  const originals = new Map<number, unknown[]>();
  const added = new Set<number>();
  const deleted = new Set<number>();

  const pkCols = () => columns.map((c, i) => (c.pk ? i : -1)).filter((i) => i >= 0);
  const canEditRows = () => I.editable && isSql && pkCols().length > 0;
  const savingCells = new Set<string>();
  const canEditCell = (r: number, c: number) => (isSql ? canEditRows() : I.editable && docs[r]?._id !== undefined && columns[c]?.name !== '_id' && !savingCells.has(`${r}:${c}`));
  const dirty = () => edits.size > 0 || added.size > 0 || deleted.size > 0;

  const quote = (n: string) =>
    I.dialect === 'postgres' || I.dialect === 'snowflake'
      ? `"${n.replace(/"/g, '""')}"`
      : I.dialect === 'bigquery'
        ? `\`${n.replace(/[\\`]/g, '\\$&')}\``
        : `\`${n.replace(/`/g, '``')}\``;
  const sqlLiteral = (v: unknown) => {
    if (v === null) return 'NULL';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return I.dialect === 'bigquery' ? `'${s.replace(/[\\']/g, '\\$&').replace(/\n/g, '\\n')}'` : `'${s.replace(/'/g, "''")}'`;
  };

  const inputs = {
    a: h('input.input.mono', {
      placeholder: isSql ? "id > 10 AND status = 'active'" : I.mode === 'mongo' ? '{ "status": "active" }' : 'status:active AND age:>30  or  { "match": { ... } }',
    }) as HTMLInputElement,
    b: h('input.input.mono', { placeholder: isSql ? 'created_at DESC' : I.mode === 'mongo' ? '{ "_id": -1 }' : '@timestamp desc' }) as HTMLInputElement,
    c: h('input.input.mono', { placeholder: '{ "name": 1 }' }) as HTMLInputElement,
  };

  const grid = new Grid({
    sort: 'server',
    editable: canEditCell,
    rowOffset: () => page * pageSize,
    onSort: (c, dir) => {
      const name = columns[c].name;
      if (isSql) inputs.b.value = dir ? `${quote(name)} ${dir.toUpperCase()}` : '';
      else if (I.mode === 'mongo') inputs.b.value = dir ? JSON.stringify({ [name]: dir === 'asc' ? 1 : -1 }) : '';
      else inputs.b.value = dir ? `${name} ${dir}` : '';
      void load(true);
    },
    onEdit: (r, c, value) => (isSql ? setCell(r, c, value) : void saveDocCell(r, c, value)),
    onActivate: (r, c) => viewValue(columns[c].name, rows[r][c]),
    onContextMenu: (e, r, c) => contextMenu(e.clientX, e.clientY, menuFor(r, c)),
    onSelect: () => updateActions(),
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

  async function saveDocCell(r: number, c: number, text: string | null): Promise<void> {
    const key = `${r}:${c}`;
    const doc = docs[r];
    const field = columns[c].name;
    const before = rows[r][c];
    savingCells.add(key);
    try {
      await writeDocField(doc, field, parseCellValue(text, before));
      toast('Value saved', 'success', undefined, before === undefined ? undefined : { label: 'Undo', run: () => undo(() => writeDocField(doc, field, before)) });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      savingCells.delete(key);
    }
  }

  async function writeDocField(doc: Record<string, unknown>, field: string, value: unknown): Promise<void> {
    await rpc('updateField', { id: doc._id, field, text: JSON.stringify(value) });
    Object.defineProperty(doc, field, { value, enumerable: true, writable: true, configurable: true });
    const r = docs.indexOf(doc);
    const c = columns.findIndex((x) => x.name === field);
    if (r >= 0 && c >= 0) rows[r][c] = value;
    grid.refresh();
  }

  async function undo(revert: () => Promise<unknown>): Promise<void> {
    try {
      await revert();
      toast('Change undone', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

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
    updateActions();
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
        action: () =>
          rpc('copy', {
            text: JSON.stringify(
              isSql
                ? toObjects(
                    columns.map((x) => x.name),
                    sel.map((i) => rows[i]),
                  )
                : sel.map((i) => docs[i]),
              null,
              2,
            ),
          }),
      },
    ];
    if (isSql)
      items.push({
        label: 'Copy as INSERT',
        icon: 'code',
        action: async () =>
          rpc('copy', { text: await rpc('insertSql', { columns: columns.map((x) => x.name), rows: sel.map((i) => rows[i]) }) }).then(() => toast('INSERT statements copied')),
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
        { label: sel.length > 1 ? `Duplicate ${sel.length} rows` : 'Duplicate row', icon: 'copy', action: duplicateRows },
        { label: deleted.has(r) ? 'Restore row(s)' : 'Delete row(s)', icon: 'trash', danger: !deleted.has(r), action: () => void deleteSelected() },
      );
    }
    if (!isSql && I.editable) {
      items.push(
        '-',
        ...(canEditCell(r, c) ? [{ label: 'Edit cell', icon: 'edit', action: () => grid.startEdit(rowsView(r), c) }] : []),
        { label: 'Edit document', icon: 'edit', action: () => editDoc(r) },
        { label: 'Duplicate row', icon: 'copy', action: () => insertDoc(docs[r]) },
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
    modal(
      `Edit document`,
      ta,
      [
        { label: 'Cancel' },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            JSON.parse(ta.value);
            await rpc('replace', { id: doc._id, text: ta.value });
            toast('Document saved', 'success', undefined, { label: 'Undo', run: () => undo(() => rpc('replace', { id: doc._id, text: JSON.stringify(doc) }).then(() => load())) });
            void load();
          },
        },
      ],
      { icon: 'edit', wide: true },
    );
  }

  function insertDoc(template?: Record<string, unknown>): void {
    const base = { ...(template ?? docs[0]) };
    delete base._id;
    const ta = jsonEditor(JSON.stringify(base, null, 2) === '{}' ? (I.mode === 'es' ? '{\n  "_id": "",\n  \n}' : '{\n  \n}') : JSON.stringify(base, null, 2), 22);
    modal(
      I.mode === 'mongo' ? 'Insert document(s)' : 'Index document',
      h(
        'div.col',
        null,
        ta,
        h(
          'div.muted',
          { style: 'font-size:11.5px' },
          I.mode === 'mongo' ? 'Extended JSON. Paste an array to insert many documents.' : 'Leave out "_id" to let Elasticsearch generate one.',
        ),
      ),
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
      updateActions();
      return;
    }
    const ok = await rpc<boolean>('confirm', { message: `Delete ${sel.length} document(s)?`, action: 'Delete' });
    if (!ok) return;
    try {
      const removed = sel.map((r) => docs[r]);
      const n = await rpc<number>('remove', { ids: removed.map((d) => d._id) });
      toast(`Deleted ${n} document(s)`, 'success', undefined, { label: 'Undo', run: () => undo(() => restoreDocs(removed)) });
      void load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function restoreDocs(removed: Record<string, unknown>[]): Promise<void> {
    if (I.mode === 'mongo') await rpc('insert', { text: JSON.stringify(removed) });
    else for (const d of removed) await rpc('insert', { text: JSON.stringify(d) });
    await load();
  }

  function addRow(): void {
    const r = rows.length;
    rows.push(columns.map(() => undefined));
    added.add(r);
    grid.setData(columns, rows, true);
    grid.scrollToRow(r);
    const first = columns.findIndex((c) => !/auto_increment|nextval|identity/i.test(`${c.type ?? ''}`));
    grid.startEdit(grid.viewCount - 1, Math.max(0, first));
    updateActions();
  }

  function duplicateRows(): void {
    const sel = grid.selectedRows().filter((r) => !deleted.has(r));
    if (!sel.length) return;
    for (const r of sel) {
      added.add(rows.length);
      rows.push(duplicateRow(columns, rows[r]));
    }
    grid.setData(columns, rows, true);
    grid.scrollToRow(rows.length - 1);
    updateActions();
  }

  async function save(): Promise<void> {
    if (!dirty()) return;
    const pks = pkCols();
    const keyOf = (r: number) => Object.fromEntries(pks.map((c) => [columns[c].name, (originals.get(r) ?? rows[r])[c]]));
    const asObject = (row: unknown[]) => Object.fromEntries(columns.map((c, i) => [c.name, row[i]]).filter(([, v]) => v !== undefined));
    const updated = [...edits].filter(([r]) => !deleted.has(r));
    const removed = [...deleted].filter((r) => !added.has(r));
    const changes: RowChanges = {
      updates: updated.map(([r, m]) => ({ key: keyOf(r), values: Object.fromEntries([...m].map(([c, v]) => [columns[c].name, v])) })),
      inserts: [...added].filter((r) => !deleted.has(r)).map((r) => asObject(rows[r])),
      deletes: removed.map(keyOf),
    };
    const revert = undoChanges(
      pks.map((c) => columns[c].name),
      changes,
      updated.map(([r]) => asObject(originals.get(r)!)),
      removed.map((r) => asObject(originals.get(r) ?? rows[r])),
    );
    loading(app, true);
    try {
      const n = await rpc<number>('apply', changes);
      toast(`Saved · ${n} row(s) affected`, 'success', undefined, revert ? { label: 'Undo', run: () => undo(() => rpc('apply', revert).then(() => load())) } : undefined);
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
    updateActions();
  }

  function params(): Record<string, unknown> {
    const search = searchInput.value.trim();
    if (isSql) return { search, limit: pageSize, offset: page * pageSize, where: inputs.a.value, orderBy: inputs.b.value };
    if (I.mode === 'mongo') return { search, filter: inputs.a.value, sort: inputs.b.value, projection: inputs.c.value, skip: page * pageSize, limit: pageSize };
    return { search, query: inputs.a.value, sort: inputs.b.value, from: page * pageSize, size: pageSize };
  }

  async function load(resetPage = false, initial = false): Promise<void> {
    if (!initial) pin();
    if (dirty()) {
      const ok = await rpc<boolean>('confirm', { message: 'Discard unsaved changes?', action: 'Discard' });
      if (!ok) return;
    }
    const search = searchInput.value.trim();
    if (resetPage) {
      page = 0;
      total = undefined;
    }
    const seq = ++loadSeq;
    loading(app, true);
    clear(searchStatus, h('span.spinner', { 'aria-label': 'Searching' }));
    searchInput.setAttribute('aria-busy', 'true');
    try {
      const p = params();
      const r = initial && I.initialData ? I.initialData : await rpc<PageData>(initial ? 'initialLoad' : 'load', p);
      I.initialData = undefined;
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
      loaded = true;
      errorBox.classList.add('hidden');
      grid.emptyText = inputs.a.value || search ? 'No rows match the filter' : 'Empty';
      grid.highlight = search;
      renderBody();
      grid.setData(columns, rows, true);
      if (initial) reportShown(r.durationMs);
      if (isSql || I.mode === 'mongo') {
        if (r.total === undefined && (resetPage || total === undefined)) {
          total = undefined;
          rpc<number>('count', isSql ? { where: p.where, search: p.search } : { filter: p.filter, search: p.search })
            .then((n) => {
              if (seq === loadSeq) {
                total = n;
                updateActions();
              }
            })
            .catch(() => undefined);
        }
      }
    } catch (e) {
      if (seq !== loadSeq) return;
      if (!loaded) {
        loaded = true;
        renderBody();
      }
      clear(errorBox, h('div.head', null, icon('error'), 'Query failed'), (e as Error).message);
      errorBox.classList.remove('hidden');
    } finally {
      if (seq === loadSeq) {
        loading(app, false);
        clear(searchStatus, icon('search'));
        searchInput.setAttribute('aria-busy', 'false');
      }
      updateActions();
    }
  }

  const errorBox = h('div.message.error.hidden');
  const content = h('div.split');
  const actions = h('div.toolbar.actions');

  function skeleton(): HTMLElement {
    const widths = [8, 18, 26, 14, 22, 12];
    const row = (cls: string) =>
      h(
        `div.skeleton-row${cls}`,
        null,
        widths.map((w) => h('span', { style: `flex:${w}` })),
      );
    return h(
      'div.skeleton',
      { 'aria-busy': 'true', 'aria-label': 'Loading rows' },
      row('.head'),
      Array.from({ length: 14 }, () => row('')),
    );
  }

  function renderBody(): void {
    if (!loaded) {
      if (!I.initialData) clear(content, skeleton(), side);
    } else if (view === 'json' && !isSql) clear(content, h('div.scroll', null, jsonView(docs, 1)), side);
    else clear(content, h('div.grid-wrap', null, grid.el), side);
  }

  function updateActions(): void {
    const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
    const from = rows.length ? page * pageSize + 1 : 0;
    const to = page * pageSize + rows.filter((_, i) => !added.has(i)).length;
    const sel = grid.selectedRows().length;
    const pendingCount = edits.size + added.size + deleted.size;
    if (pendingCount) pin();
    const sizeSel = h(
      'select.select.sm',
      { title: 'Rows per page' },
      [25, 50, 100, 200, 500, 1000].map((n) => h('option', { value: String(n), selected: n === pageSize }, String(n))),
    ) as HTMLSelectElement;
    sizeSel.addEventListener('change', () => {
      pageSize = Number(sizeSel.value);
      void load(true);
    });
    const left: (HTMLElement | null)[] = [];
    if (isSql && I.editable && pkCols().length) {
      left.push(btn('Add row', { icon: 'add', class: 'sm outline', onClick: addRow }));
      if (pendingCount) {
        left.push(
          h('div.sep'),
          h('span.badge.warn', null, `${pendingCount} pending`),
          btn('Save', { icon: 'save', class: 'sm primary', title: 'Save changes (⌘S)', onClick: () => void save() }),
          btn('Discard', { icon: 'discard', class: 'sm ghost', onClick: discard }),
        );
      }
    } else if (isSql && I.editable && columns.length) {
      left.push(h('span.badge.outline', { title: 'Rows can only be edited when the table has a primary key' }, icon('lock'), 'No primary key · read only'));
    } else if (isSql && !I.editable) {
      left.push(h('span.badge.outline', null, icon('lock'), 'Read only'));
    }
    if (!isSql) {
      left.push(
        h(
          'div.btn-group',
          null,
          btn(null, {
            icon: 'table',
            class: `sm outline ${view === 'grid' ? 'active' : ''}`,
            title: 'Table view',
            onClick: () => ((view = 'grid'), pin(), renderBody(), updateActions()),
          }),
          btn(null, {
            icon: 'json',
            class: `sm outline ${view === 'json' ? 'active' : ''}`,
            title: 'JSON view',
            onClick: () => ((view = 'json'), pin(), renderBody(), updateActions()),
          }),
        ),
      );
      if (I.editable) {
        left.push(
          btn(I.mode === 'mongo' ? 'Insert' : 'Add', { icon: 'add', class: 'sm outline', onClick: () => insertDoc() }),
          btn('Edit', { icon: 'edit', class: 'sm outline', disabled: sel !== 1, onClick: () => editDoc(grid.selectedRows()[0]) }),
        );
      }
    }
    clear(
      actions,
      h(
        'div.data-search',
        null,
        searchStatus,
        searchInput,
        btn(null, { icon: 'arrow-right', class: 'sm ghost', title: 'Search all records', onClick: () => void load(true) }),
        btn(null, {
          icon: 'close',
          class: 'sm ghost',
          title: 'Clear search',
          onClick: () => {
            searchInput.value = '';
            void load(true);
          },
        }),
      ),
      left,
      h('div.grow'),
      h(
        'span.muted',
        { style: 'font-variant-numeric:tabular-nums' },
        sel > 1 ? `${sel} selected · ` : '',
        rows.length ? `${fmtNum(from)}–${fmtNum(to)}${total !== undefined ? ` of ${fmtNum(total)}` : ''}` : total === 0 ? '0 rows' : '',
      ),
      h('span.muted', { title: 'Database query time; excludes panel startup and rendering' }, fmtMs(duration)),
      h('div.sep'),
      h('label.row.muted', { style: 'gap:6px' }, 'Rows per page', sizeSel),
      h('span.page', null, `Page ${page + 1}${pages ? ` of ${fmtNum(pages)}` : ''}`),
      h(
        'div.pager',
        null,
        btn(null, { icon: 'chevron-left', class: 'sm outline', title: 'Previous page', disabled: page === 0, onClick: () => go(page - 1) }),
        btn(null, {
          icon: 'chevron-right',
          class: 'sm outline',
          title: 'Next page',
          disabled: pages !== undefined ? page + 1 >= pages : rows.length < pageSize,
          onClick: () => go(page + 1),
        }),
        pages ? btn(null, { icon: 'debug-step-over', class: 'sm outline', title: 'Last page', disabled: page + 1 >= pages, onClick: () => go(pages - 1) }) : null,
      ),
    );
  }

  function go(p: number): void {
    page = Math.max(0, p);
    void load();
  }

  function filterField(tag: string, input: HTMLInputElement, width: string, w = 58): HTMLElement {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void load(true);
    });
    const ai =
      tag === 'WHERE'
        ? btn(null, {
            icon: 'sparkle',
            class: 'sm ghost ai-filter-button',
            title: 'Generate a WHERE filter with AI · describe it in this field',
            onClick: async () => {
              ai!.disabled = true;
              ai!.setAttribute('aria-busy', 'true');
              ai!.setAttribute('aria-label', 'AI is generating your filter');
              ai!.title = 'AI is generating your filter…';
              clear(ai!, h('span.spinner', { 'aria-hidden': true }));
              wrap.classList.add('ai-busy');
              const original = input.value;
              try {
                const filter = await rpc<string | null>('aiFilter', { prompt: original });
                if (filter !== null && input.value === original) {
                  wrap.classList.remove('ai-busy');
                  await typeOut(filter, (value) => (input.value = value), 600);
                  flash(wrap, 'ai-done');
                  await load(true);
                }
              } catch (e) {
                toast((e as Error).message, 'error');
              } finally {
                wrap.classList.remove('ai-busy');
                ai!.disabled = false;
                ai!.removeAttribute('aria-busy');
                ai!.setAttribute('aria-label', 'Generate a WHERE filter with AI');
                ai!.title = 'Generate a WHERE filter with AI · describe it in this field';
                clear(ai!, icon('sparkle'));
              }
            },
          })
        : null;
    const wrap = h('div.input-wrap', { class: ai ? 'ai-filter-wrap' : '', style: `flex:${width};--tag-w:${w}px` }, h('span.tag', null, tag), input, ai);
    return wrap;
  }

  async function exportData(kind: 'csv' | 'json'): Promise<void> {
    const name = `${I.title}-${new Date().toISOString().slice(0, 10)}.${kind}`;
    const content =
      kind === 'csv'
        ? toCsv(
            columns.map((c) => c.name),
            rows,
          )
        : JSON.stringify(
            isSql
              ? toObjects(
                  columns.map((c) => c.name),
                  rows,
                )
              : docs,
            null,
            2,
          );
    const path = await rpc<string | undefined>('saveFile', { name, content });
    if (path) toast(`Exported ${rows.length} rows to ${path}`, 'success');
  }

  function render(): void {
    const stats = h('span.badge');
    const statsLoader = isSql
      ? null
      : rpc<string>('stats')
          .then((s) => (stats.textContent = s))
          .catch(() => stats.remove());
    void statsLoader;
    const filters = isSql
      ? [filterField('WHERE', inputs.a, '3'), filterField('ORDER BY', inputs.b, '1.3', 76)]
      : I.mode === 'mongo'
        ? [filterField('FILTER', inputs.a, '3'), filterField('SORT', inputs.b, '1.2', 50), filterField('PROJECT', inputs.c, '1.2', 68)]
        : [filterField('QUERY', inputs.a, '3'), filterField('SORT', inputs.b, '1.2', 50)];
    clear(
      app,
      h(
        'div.header',
        null,
        h('div.type-icon', null, icon(isSql ? 'table' : I.mode === 'mongo' ? 'symbol-array' : 'symbol-file')),
        h('div.col.grow', { style: 'gap:1px' }, h('div.title', null, I.title), h('div.crumb', null, I.location)),
        isSql ? null : stats,
        isSql
          ? btn('DDL', {
              icon: 'code',
              class: 'sm ghost',
              title: 'Show CREATE statement',
              onClick: async () => rpc('openInEditor', { content: await rpc('ddl'), language: 'sql' }),
            })
          : null,
        I.mode === 'es'
          ? btn('Mapping', { icon: 'symbol-structure', class: 'sm ghost', onClick: async () => rpc('openInEditor', { content: await rpc('mapping'), language: 'json' }) })
          : null,
        btn('CSV', { icon: 'export', class: 'sm ghost', title: 'Export current page as CSV', onClick: () => void exportData('csv') }),
        btn('JSON', { icon: 'export', class: 'sm ghost', title: 'Export current page as JSON', onClick: () => void exportData('json') }),
        btn(null, { icon: 'refresh', class: 'sm outline', title: 'Refresh (F5)', onClick: () => void load() }),
      ),
      h(
        'div.toolbar',
        null,
        filters,
        btn('Apply', { class: 'sm primary apply-filter', onClick: () => void load(true) }),
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
      actions,
      errorBox,
      content,
    );
    renderBody();
    updateActions();
  }

  render();
  void load(true, true);
  return {
    save,
    load: () => load(),
    dispose: () => {
      loadSeq++;
      loading(app, false);
    },
  };
}

function mountHome(I: HomeInit): ReturnType<typeof mount> {
  pinned = true;
  documentTiming = false;
  clear(
    app,
    h(
      'div.empty',
      null,
      icon('database'),
      h('div.big', null, 'Pick a table'),
      h('div', null, 'Select a table in Connections to open it here.'),
      I.recent.length
        ? h(
            'div.home-recent',
            null,
            I.recent.map((r) =>
              h(
                'button.btn.ghost.home-item',
                { onClick: () => vscode.postMessage({ type: 'open', node: r.node }) },
                icon('table'),
                h('span.home-name', null, r.node.table ?? r.node.label),
                h('span.home-location', null, r.location),
              ),
            ),
          )
        : null,
    ),
  );
  requestAnimationFrame(() => setTimeout(() => vscode.postMessage({ type: 'ready' })));
  return { save: async () => undefined, load: async () => undefined, dispose: () => undefined };
}

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void current.save();
  } else if (e.key === 'F5' || (mod && e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    void current.load();
  }
});
for (const type of ['input', 'change', 'dblclick']) document.addEventListener(type, pin, true);

let current = INIT.mode === 'home' ? mountHome(INIT as HomeInit) : mount(INIT as Init);
releaseWorker();
onMessage('mount', (m: { init: Init }) => {
  current.dispose();
  pinned = false;
  current = mount(m.init);
});
