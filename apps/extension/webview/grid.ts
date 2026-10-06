import { display, esc, h, raw, rpc, toTsv } from './lib';

export interface GridColumn {
  name: string;
  type?: string;
  pk?: boolean;
  nullable?: boolean;
}

export interface GridOptions {
  editable?: () => boolean;
  sort?: 'client' | 'server' | 'none';
  onSort?: (col: number, dir: 'asc' | 'desc' | null) => void;
  onEdit?: (row: number, col: number, value: string | null) => void;
  onContextMenu?: (e: MouseEvent, row: number, col: number) => void;
  onActivate?: (row: number, col: number) => void;
  onSelect?: () => void;
  onKey?: (e: KeyboardEvent) => boolean | void;
  rowClass?: (row: number) => string;
  cellClass?: (row: number, col: number) => string;
  rowOffset?: () => number;
}

const RH = 30;
const HH = 40;
const RN = 52;
const OVERSCAN = 10;
const NUMERIC = /int|float|double|decimal|numeric|real|serial|number|money|newdecimal|long|tiny|short/i;

export class Grid {
  readonly el: HTMLDivElement;
  private inner: HTMLDivElement;
  private header: HTMLDivElement;
  private body: HTMLDivElement;
  private emptyEl: HTMLDivElement;
  columns: GridColumn[] = [];
  rows: unknown[][] = [];
  private order: number[] = [];
  private widths: number[] = [];
  private numeric: boolean[] = [];
  private sortCol = -1;
  private sortDir: 'asc' | 'desc' | null = null;
  private filterText = '';
  private focus: { v: number; c: number } | null = null;
  selected = new Set<number>();
  private anchor = -1;
  private editor?: HTMLInputElement;
  private frame = 0;
  private preview?: HTMLDivElement;
  private previewCell?: HTMLElement;
  private previewShowTimer?: ReturnType<typeof setTimeout>;
  private previewHideTimer?: ReturnType<typeof setTimeout>;
  emptyText = 'No rows';

  constructor(private readonly opts: GridOptions = {}) {
    this.header = h('div.grid-header');
    this.body = h('div.grid-body', { style: 'position:relative' });
    this.inner = h('div.grid-inner', null, this.header, this.body);
    this.emptyEl = h('div.grid-empty.hidden');
    this.el = h('div.grid', { tabindex: '0' }, this.inner, this.emptyEl);
    this.el.addEventListener('scroll', () => this.schedule());
    new ResizeObserver(() => this.schedule()).observe(this.el);
    this.body.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.body.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.body.addEventListener('contextmenu', (e) => this.onContext(e));
    this.body.addEventListener('mouseover', (e) => this.onCellHover(e));
    this.body.addEventListener('mousemove', (e) => this.onCellHover(e));
    this.body.addEventListener('mouseout', (e) => {
      const next = e.relatedTarget as Node | null;
      if (next && (this.previewCell?.contains(next) || this.preview?.contains(next))) return;
      this.deferPreviewHide();
    });
    this.el.addEventListener('scroll', () => this.hidePreview());
    this.el.addEventListener('mousedown', () => this.hidePreview());
    window.addEventListener('blur', () => this.hidePreview());
    window.addEventListener('resize', () => this.hidePreview());
    this.header.addEventListener('mousedown', (e) => this.onHeaderDown(e));
    this.el.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  setData(columns: GridColumn[], rows: unknown[][], keepLayout = false): void {
    this.closeEditor(false);
    const same = keepLayout && columns.length === this.columns.length && columns.every((c, i) => c.name === this.columns[i]?.name);
    this.columns = columns;
    this.rows = rows;
    this.numeric = columns.map((c) => !!c.type && NUMERIC.test(c.type));
    if (!same) {
      this.widths = this.measure();
      if (this.opts.sort !== 'server') {
        this.sortCol = -1;
        this.sortDir = null;
      }
      this.el.scrollTop = 0;
      this.el.scrollLeft = 0;
    }
    this.selected.clear();
    this.focus = null;
    this.anchor = -1;
    this.computeOrder();
    this.renderHeader();
    this.renderBody();
  }

  setFilter(text: string): void {
    this.filterText = text.toLowerCase();
    this.computeOrder();
    this.renderHeader();
    this.renderBody();
  }

  setSortIndicator(col: number, dir: 'asc' | 'desc' | null): void {
    this.sortCol = dir ? col : -1;
    this.sortDir = dir;
    this.renderHeader();
  }

  refresh(): void {
    this.renderBody();
  }

  visibleRows(): unknown[][] {
    return this.order.map((i) => this.rows[i]);
  }

  get viewCount(): number {
    return this.order.length;
  }

  selectedRows(): number[] {
    if (this.selected.size) return [...this.selected].sort((a, b) => a - b);
    if (this.focus) return [this.order[this.focus.v]];
    return [];
  }

  focusedCell(): { r: number; c: number } | null {
    return this.focus ? { r: this.order[this.focus.v], c: this.focus.c } : null;
  }

  scrollToRow(r: number): void {
    const v = this.order.indexOf(r);
    if (v < 0) return;
    this.focus = { v, c: 0 };
    this.selected = new Set([r]);
    this.ensureVisible(v, 0);
    this.renderBody();
  }

  private measure(): number[] {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const cs = getComputedStyle(document.body);
    const mono = cs.getPropertyValue('--vscode-editor-font-family') || 'monospace';
    const ui = cs.getPropertyValue('--vscode-font-family') || 'sans-serif';
    return this.columns.map((col, c) => {
      ctx.font = `500 13px ${ui}`;
      let w = ctx.measureText(col.name).width + (col.pk ? 18 : 0) + 30;
      ctx.font = `11px ${ui}`;
      if (col.type) w = Math.max(w, ctx.measureText(col.type).width + 22);
      ctx.font = `12px ${mono}`;
      const n = Math.min(this.rows.length, 60);
      for (let i = 0; i < n; i++) {
        const s = display(this.rows[i][c], 48);
        w = Math.max(w, ctx.measureText(s).width + 24);
      }
      return Math.round(Math.min(380, Math.max(70, w)));
    });
  }

  private computeOrder(): void {
    let idx = this.rows.map((_, i) => i);
    if (this.filterText) {
      const f = this.filterText;
      idx = idx.filter((i) => this.rows[i].some((v) => v !== null && v !== undefined && display(v, 10000).toLowerCase().includes(f)));
    }
    if (this.opts.sort !== 'server' && this.sortCol >= 0 && this.sortDir) {
      const c = this.sortCol;
      const dir = this.sortDir === 'asc' ? 1 : -1;
      idx.sort((a, b) => compare(this.rows[a][c], this.rows[b][c]) * dir || a - b);
    }
    this.order = idx;
  }

  private get totalWidth(): number {
    return RN + this.widths.reduce((a, b) => a + b, 0);
  }

  private renderHeader(): void {
    const total = this.totalWidth;
    this.inner.style.width = `${total}px`;
    this.inner.style.height = `${HH + this.order.length * RH}px`;
    this.body.style.height = `${this.order.length * RH}px`;
    const sortable = this.opts.sort !== 'none';
    let html = `<div class="rownum" style="width:${RN}px"><i class="codicon codicon-list-flat" style="font-size:12px;opacity:.6"></i></div>`;
    this.columns.forEach((col, c) => {
      const sort = this.sortCol === c && this.sortDir ? `<i class="codicon codicon-arrow-${this.sortDir === 'asc' ? 'up' : 'down'} sort"></i>` : '';
      const pk = col.pk ? '<i class="codicon codicon-key pk"></i>' : '';
      html += `<div class="gh${sortable ? ' sortable' : ''}" style="width:${this.widths[c]}px" data-c="${c}" title="${esc(col.name + (col.type ? ` · ${col.type}` : ''))}">
        <div class="name">${pk}<span style="overflow:hidden;text-overflow:ellipsis">${esc(col.name)}</span>${sort}</div>
        ${col.type ? `<div class="type">${esc(col.type)}</div>` : ''}
        <div class="resizer" data-r="${c}"></div></div>`;
    });
    this.header.style.width = `${total}px`;
    this.header.innerHTML = html;
    this.emptyEl.textContent = this.emptyText;
    this.emptyEl.classList.toggle('hidden', this.order.length > 0 || this.columns.length === 0);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderBody();
    });
  }

  private renderBody(): void {
    this.hidePreview();
    const top = Math.max(0, this.el.scrollTop - HH);
    const height = this.el.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / RH) - OVERSCAN);
    const last = Math.min(this.order.length, Math.ceil((top + height) / RH) + OVERSCAN);
    const total = this.totalWidth;
    const offset = this.opts.rowOffset?.() ?? 0;
    let html = '';
    for (let v = first; v < last; v++) {
      const r = this.order[v];
      const row = this.rows[r];
      const cls = `${this.selected.has(r) ? ' selected' : ''} ${this.opts.rowClass?.(r) ?? ''}`;
      html += `<div class="gr${cls}" style="top:${v * RH}px;width:${total}px" data-v="${v}"><div class="gc rownum" style="width:${RN}px">${offset + r + 1}</div>`;
      for (let c = 0; c < this.columns.length; c++) {
        const val = row[c];
        let content: string;
        let cls = this.numeric[c] || typeof val === 'number' ? 'num' : '';
        if (val === null) content = '<span class="null">NULL</span>';
        else if (val === undefined) content = '<span class="undef"></span>';
        else if (typeof val === 'boolean') content = `<span class="bool">${val}</span>`;
        else if (typeof val === 'object') content = `<span class="jv">${esc(display(val, 200))}</span>`;
        else content = esc(display(val, 200));
        if (this.focus && this.focus.v === v && this.focus.c === c) cls += ' focus';
        const extra = this.opts.cellClass?.(r, c);
        if (extra) cls += ` ${extra}`;
        html += `<div class="gc ${cls}" style="width:${this.widths[c]}px" data-c="${c}">${content}</div>`;
      }
      html += '</div>';
    }
    this.body.innerHTML = html;
  }

  private hidePreview(): void {
    clearTimeout(this.previewShowTimer);
    clearTimeout(this.previewHideTimer);
    this.previewShowTimer = undefined;
    this.previewHideTimer = undefined;
    this.preview?.remove();
    this.preview = undefined;
    this.previewCell = undefined;
  }

  private deferPreviewHide(): void {
    clearTimeout(this.previewShowTimer);
    this.previewShowTimer = undefined;
    clearTimeout(this.previewHideTimer);
    this.previewHideTimer = setTimeout(() => this.hidePreview(), 180);
  }

  private onCellHover(e: MouseEvent): void {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.gc[data-c]');
    if (cell === this.previewCell) {
      clearTimeout(this.previewHideTimer);
      if (this.preview || this.previewShowTimer) return;
    }
    this.hidePreview();
    const hit = this.hit(e);
    if (!cell || !hit || hit.rownum || this.editor) return;
    const value = this.rows[this.order[hit.v]][hit.c];
    if (value === null || value === undefined) return;
    const full = display(value, Infinity);
    if (cell.scrollWidth <= cell.clientWidth && full === display(value, 200) && !/[\r\n\t]/.test(full)) return;
    this.previewCell = cell;
    this.previewShowTimer = setTimeout(() => {
      this.previewShowTimer = undefined;
      if (!cell.isConnected) return;
      let text = raw(value);
      if (typeof value === 'string' && (/^\s*[[{]/.test(value) || /\bjsonb?\b/i.test(this.columns[hit.c].type ?? ''))) {
        try {
          text = JSON.stringify(JSON.parse(value), null, 2);
        } catch {
          // Keep invalid JSON readable as its original text.
        }
      }
      const preview = h('div.grid-preview', { role: 'tooltip' }, h('div.grid-preview-heading', null, this.columns[hit.c].name), h('pre', null, text));
      preview.addEventListener('mouseenter', () => clearTimeout(this.previewHideTimer));
      preview.addEventListener('mouseleave', () => this.deferPreviewHide());
      preview.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this.hidePreview();
      });
      document.body.appendChild(preview);
      this.preview = preview;
      const rect = cell.getBoundingClientRect();
      const bounds = preview.getBoundingClientRect();
      preview.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8))}px`;
      const below = rect.bottom + 4;
      preview.style.top = `${Math.max(8, below + bounds.height <= window.innerHeight - 8 ? below : rect.top - bounds.height - 4)}px`;
    }, 400);
  }

  private hit(e: MouseEvent): { v: number; c: number; rownum: boolean } | null {
    const t = e.target as HTMLElement;
    const rowEl = t.closest('.gr') as HTMLElement | null;
    if (!rowEl) return null;
    const cell = t.closest('.gc') as HTMLElement | null;
    const rownum = !!cell?.classList.contains('rownum');
    return { v: Number(rowEl.dataset.v), c: cell && !rownum ? Number(cell.dataset.c) : 0, rownum };
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const hit = this.hit(e);
    if (!hit) return;
    this.closeEditor(true);
    const r = this.order[hit.v];
    if (e.shiftKey && this.anchor >= 0) {
      const [a, b] = [Math.min(this.anchor, hit.v), Math.max(this.anchor, hit.v)];
      this.selected = new Set(this.order.slice(a, b + 1));
    } else if (e.metaKey || e.ctrlKey) {
      if (this.selected.has(r)) this.selected.delete(r);
      else this.selected.add(r);
      this.anchor = hit.v;
    } else {
      this.selected = new Set([r]);
      this.anchor = hit.v;
    }
    this.focus = { v: hit.v, c: hit.c };
    this.paint();
    this.el.focus({ preventScroll: true });
    this.opts.onSelect?.();
  }

  private paint(): void {
    for (const rowEl of Array.from(this.body.children) as HTMLElement[]) {
      const v = Number(rowEl.dataset.v);
      rowEl.classList.toggle('selected', this.selected.has(this.order[v]));
      const cells = rowEl.children;
      for (let i = 1; i < cells.length; i++) cells[i].classList.toggle('focus', !!this.focus && this.focus.v === v && this.focus.c === i - 1);
    }
  }

  private onDblClick(e: MouseEvent): void {
    const hit = this.hit(e);
    if (!hit || hit.rownum) return;
    if (this.opts.editable?.()) this.startEdit(hit.v, hit.c);
    else this.opts.onActivate?.(this.order[hit.v], hit.c);
  }

  private onContext(e: MouseEvent): void {
    e.preventDefault();
    const hit = this.hit(e);
    if (!hit) return;
    const r = this.order[hit.v];
    if (!this.selected.has(r)) {
      this.selected = new Set([r]);
      this.anchor = hit.v;
    }
    this.focus = { v: hit.v, c: hit.c };
    this.paint();
    this.opts.onSelect?.();
    this.opts.onContextMenu?.(e, r, hit.c);
  }

  private onHeaderDown(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const res = t.closest('.resizer') as HTMLElement | null;
    if (res) {
      e.preventDefault();
      e.stopPropagation();
      const c = Number(res.dataset.r);
      const startX = e.clientX;
      const startW = this.widths[c];
      res.classList.add('active');
      const move = (ev: MouseEvent) => {
        this.widths[c] = Math.max(40, startW + ev.clientX - startX);
        this.renderHeader();
        this.renderBody();
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      return;
    }
    const gh = t.closest('.gh') as HTMLElement | null;
    if (!gh || this.opts.sort === 'none' || e.button !== 0) return;
    const c = Number(gh.dataset.c);
    const dir: 'asc' | 'desc' | null = this.sortCol !== c ? 'asc' : this.sortDir === 'asc' ? 'desc' : this.sortDir === 'desc' ? null : 'asc';
    this.sortCol = dir ? c : -1;
    this.sortDir = dir;
    if (this.opts.sort === 'server') {
      this.renderHeader();
      this.opts.onSort?.(c, dir);
    } else {
      this.computeOrder();
      this.renderHeader();
      this.renderBody();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.hidePreview();
    if (this.editor) return;
    if (this.opts.onKey?.(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      void this.copy();
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.selected = new Set(this.order);
      this.renderBody();
      this.opts.onSelect?.();
      return;
    }
    if (!this.focus) {
      if (this.order.length && /^Arrow|Home|End|Page/.test(e.key)) this.focus = { v: 0, c: 0 };
      else return;
    }
    const f = this.focus;
    const page = Math.max(1, Math.floor(this.el.clientHeight / RH) - 2);
    let { v, c } = f;
    switch (e.key) {
      case 'ArrowDown':
        v++;
        break;
      case 'ArrowUp':
        v--;
        break;
      case 'ArrowLeft':
        c--;
        break;
      case 'ArrowRight':
        c++;
        break;
      case 'Tab':
        c += e.shiftKey ? -1 : 1;
        break;
      case 'PageDown':
        v += page;
        break;
      case 'PageUp':
        v -= page;
        break;
      case 'Home':
        if (mod) v = 0;
        else c = 0;
        break;
      case 'End':
        if (mod) v = this.order.length - 1;
        else c = this.columns.length - 1;
        break;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        if (this.opts.editable?.()) this.startEdit(f.v, f.c);
        else this.opts.onActivate?.(this.order[f.v], f.c);
        return;
      case 'Escape':
        this.selected.clear();
        this.renderBody();
        this.opts.onSelect?.();
        return;
      default:
        return;
    }
    e.preventDefault();
    v = Math.max(0, Math.min(this.order.length - 1, v));
    c = Math.max(0, Math.min(this.columns.length - 1, c));
    this.focus = { v, c };
    if (e.shiftKey && e.key.startsWith('Arrow') && this.anchor >= 0) {
      const [a, b] = [Math.min(this.anchor, v), Math.max(this.anchor, v)];
      this.selected = new Set(this.order.slice(a, b + 1));
    } else {
      this.selected = new Set([this.order[v]]);
      this.anchor = v;
    }
    this.ensureVisible(v, c);
    this.renderBody();
    this.opts.onSelect?.();
  }

  async copy(): Promise<void> {
    let text: string;
    if (this.selected.size > 1) text = toTsv(this.selectedRows().map((r) => this.rows[r]));
    else if (this.focus) text = raw(this.rows[this.order[this.focus.v]][this.focus.c]);
    else return;
    await rpc('copy', { text });
  }

  private ensureVisible(v: number, c: number): void {
    const top = HH + v * RH;
    if (top - HH < this.el.scrollTop) this.el.scrollTop = top - HH;
    else if (top + RH > this.el.scrollTop + this.el.clientHeight) this.el.scrollTop = top + RH - this.el.clientHeight;
    const left = RN + this.widths.slice(0, c).reduce((a, b) => a + b, 0);
    const w = this.widths[c] ?? 0;
    if (left - RN < this.el.scrollLeft) this.el.scrollLeft = left - RN;
    else if (left + w > this.el.scrollLeft + this.el.clientWidth) this.el.scrollLeft = left + w - this.el.clientWidth;
  }

  startEdit(v: number, c: number): void {
    this.hidePreview();
    this.closeEditor(true);
    this.ensureVisible(v, c);
    const r = this.order[v];
    const orig = this.rows[r][c];
    const input = h('input.grid-editor', { spellcheck: 'false' }) as HTMLInputElement;
    input.value = orig === null || orig === undefined ? '' : typeof orig === 'object' ? JSON.stringify(orig) : String(orig);
    input.placeholder = orig === null ? 'NULL' : '';
    const left = RN + this.widths.slice(0, c).reduce((a, b) => a + b, 0);
    Object.assign(input.style, { left: `${left}px`, top: `${HH + v * RH}px`, width: `${Math.max(this.widths[c], 160)}px`, height: `${RH - 1}px` });
    this.inner.appendChild(input);
    this.editor = input;
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean, move?: [number, number]) => {
      if (done) return;
      done = true;
      input.remove();
      this.editor = undefined;
      if (commit) {
        const before = orig === null || orig === undefined ? null : typeof orig === 'object' ? JSON.stringify(orig) : String(orig);
        const after = input.value === '' && orig === null ? null : input.value;
        if (after !== before) this.opts.onEdit?.(r, c, after);
      }
      if (move) {
        const nv = Math.max(0, Math.min(this.order.length - 1, v + move[0]));
        const nc = Math.max(0, Math.min(this.columns.length - 1, c + move[1]));
        this.focus = { v: nv, c: nc };
        this.ensureVisible(nv, nc);
      }
      this.renderBody();
      this.el.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true, [1, 0]);
      else if (e.key === 'Escape') finish(false);
      else if (e.key === 'Tab') {
        e.preventDefault();
        finish(true, [0, e.shiftKey ? -1 : 1]);
      }
    });
    input.addEventListener('blur', () => finish(true));
    (input as unknown as { _finish: typeof finish })._finish = finish;
  }

  private closeEditor(commit: boolean): void {
    const ed = this.editor as unknown as { _finish?: (c: boolean) => void } | undefined;
    ed?._finish?.(commit);
  }
}

function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = typeof a === 'object' ? JSON.stringify(a) : String(a);
  const sb = typeof b === 'object' ? JSON.stringify(b) : String(b);
  const na = Number(sa);
  const nb = Number(sb);
  if (sa.trim() !== '' && sb.trim() !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}
