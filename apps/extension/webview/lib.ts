declare const acquireVsCodeApi: () => { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };

export const vscode = acquireVsCodeApi();
export const INIT = (window as unknown as { __INIT__: any }).__INIT__;

let seq = 0;
const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const listeners = new Map<string, ((m: any) => void)[]>();

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m?.type === 'rpc:res') {
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.error) w.reject(new Error(m.error));
    else w.resolve(m.result);
    return;
  }
  listeners.get(m?.type)?.forEach((fn) => fn(m));
});

export function rpc<T = any>(method: string, params?: unknown): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    vscode.postMessage({ type: 'rpc', id, method, params });
  });
}

export function onMessage(type: string, fn: (m: any) => void): void {
  listeners.set(type, [...(listeners.get(type) ?? []), fn]);
}

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(sel: K | `${K}.${string}`, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = sel.split('.');
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'value') (el as unknown as HTMLInputElement).value = String(v);
    else if (k === 'checked') (el as unknown as HTMLInputElement).checked = !!v;
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function icon(name: string, extra = ''): HTMLElement {
  return h('i', { class: `codicon codicon-${name} ${extra}`.trim() });
}

export function btn(label: string | null, opts: { icon?: string; class?: string; title?: string; onClick?: (e: MouseEvent) => void; disabled?: boolean } = {}): HTMLButtonElement {
  return h(
    'button.btn',
    { class: `${opts.class ?? ''}${label ? '' : ' icon'}`, title: opts.title ?? label ?? undefined, onClick: opts.onClick, disabled: opts.disabled },
    opts.icon ? icon(opts.icon) : null,
    label,
  );
}

export function clear(el: HTMLElement, ...children: Child[]): HTMLElement {
  el.textContent = '';
  append(el, children);
  return el;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

let toastHost: HTMLElement | undefined;
export interface ToastAction {
  label: string;
  run: () => unknown;
}

export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info', ms = 3500, action?: ToastAction): void {
  toastHost ??= document.body.appendChild(h('div.toast-host'));
  const el = h(
    'div.toast',
    { class: kind },
    icon(kind === 'error' ? 'error' : kind === 'success' ? 'pass-filled' : 'info'),
    h('span', null, message),
    action
      ? btn(action.label, {
          icon: 'discard',
          class: 'sm outline toast-action',
          onClick: () => {
            el.remove();
            void action.run();
          },
        })
      : null,
  );
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' || action ? ms * 2 : ms);
}

export interface ModalAction {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick?: () => unknown | Promise<unknown>;
}

export function modal(title: string, body: Node, actions: ModalAction[], opts: { icon?: string; wide?: boolean } = {}): { close: () => void; error: (m: string) => void } {
  const err = h('div.m-error');
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const buttons = actions.map((a) =>
    btn(a.label, {
      class: a.primary ? 'primary' : a.danger ? 'danger' : '',
      onClick: async () => {
        if (!a.onClick) return close();
        err.textContent = '';
        try {
          const r = await a.onClick();
          if (r !== false) close();
        } catch (e) {
          err.textContent = (e as Error).message;
        }
      },
    }),
  );
  const box = h(
    'div.modal',
    { style: opts.wide ? 'width:min(1000px, calc(100vw - 32px))' : undefined },
    h('div.m-head', null, opts.icon ? icon(opts.icon) : null, h('span.grow', null, title), btn(null, { icon: 'close', class: 'ghost sm', onClick: () => close() })),
    h('div.m-body', null, body),
    h('div.m-foot', null, err, buttons),
  );
  const back = h('div.modal-back', { onMousedown: (e: MouseEvent) => e.target === back && close() }, box);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      buttons[actions.findIndex((a) => a.primary)]?.click();
    }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  (box.querySelector('textarea, input') as HTMLElement | null)?.focus();
  return { close, error: (m) => (err.textContent = m) };
}

export type MenuItem = { label: string; icon?: string; danger?: boolean; disabled?: boolean; action: () => void } | '-';

export function contextMenu(x: number, y: number, items: MenuItem[]): void {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = h(
    'div.menu',
    null,
    items.map((it) =>
      it === '-'
        ? h('div.msep')
        : h(
            'div.mi',
            {
              class: `${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}`,
              onClick: () => {
                menu.remove();
                it.action();
              },
            },
            icon(it.icon ?? 'blank'),
            it.label,
          ),
    ),
  );
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
  const off = (e: Event) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('mousedown', off, true);
      window.removeEventListener('blur', off);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', off, true);
    window.addEventListener('blur', off);
  });
}

export function display(v: unknown, max = 300): string {
  if (v === null) return 'NULL';
  if (v === undefined) return '';
  if (typeof v === 'object') {
    const s = ejsonShort(v) ?? JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + '…' : s;
  }
  const s = String(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function ejsonShort(v: object): string | undefined {
  const keys = Object.keys(v);
  if (keys.length !== 1) return undefined;
  const x = (v as Record<string, unknown>)[keys[0]];
  switch (keys[0]) {
    case '$oid':
      return `ObjectId(${x})`;
    case '$date':
      return typeof x === 'string' ? x : JSON.stringify(x);
    case '$numberLong':
    case '$numberDecimal':
    case '$numberDouble':
      return String(x);
    case '$uuid':
      return `UUID(${x})`;
  }
  return undefined;
}

export function raw(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
}

export function toTsv(rows: unknown[][]): string {
  return rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/[\t\n]/g, ' '))).join('\t')).join('\n');
}

export function toObjects(columns: string[], rows: unknown[][]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function typeOut(text: string, write: (value: string) => void, ms = 700): Promise<void> {
  if (reducedMotion() || !text) {
    write(text);
    return Promise.resolve();
  }
  const step = Math.max(1, Math.ceil(text.length / (ms / 16)));
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      i = Math.min(text.length, i + step);
      write(text.slice(0, i));
      if (i < text.length) requestAnimationFrame(tick);
      else resolve();
    };
    tick();
  });
}

export function flash(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  const done = (e: Event) => {
    if (e.target !== el) return;
    el.classList.remove(cls);
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

export function loading(host: HTMLElement, on: boolean): void {
  host.querySelector(':scope > .loading-bar')?.remove();
  if (on) host.prepend(h('div.loading-bar'));
}

export function jsonEditor(initial: string, rows = 18): HTMLTextAreaElement {
  const ta = h('textarea.textarea', { spellcheck: 'false', rows: String(rows) });
  ta.value = initial;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText('  ', s, ta.selectionEnd, 'end');
    }
  });
  return ta;
}
