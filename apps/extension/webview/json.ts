import { h } from './lib';

const MAX_CHILDREN = 500;

export type JsonPath = (string | number)[];

export interface JsonViewOptions {
  item?: (el: HTMLElement, index: number) => void;
  open?: Map<string, boolean>;
  key?: (path: JsonPath) => string;
}

const paths = new WeakMap<Element, JsonPath>();

export function jsonPath(line: Element): JsonPath | undefined {
  return paths.get(line);
}

export function jsonView(value: unknown, expandDepth = 2, opts: JsonViewOptions = {}): HTMLElement {
  const root = h('div.json');
  root.appendChild(node(undefined, value, [], expandDepth, true, opts));
  return root;
}

function node(key: string | undefined, value: unknown, path: JsonPath, expandDepth: number, last: boolean, opts: JsonViewOptions): HTMLElement {
  const depth = path.length;
  const line = h('div.jl');
  paths.set(line, path);
  const keyEl = key !== undefined ? [h('span.k', null, JSON.stringify(key)), ': '] : [];
  const comma = last ? '' : ',';
  if (value === null || typeof value !== 'object') {
    line.append(h('span.tog'), ...keyEl, scalar(value), comma);
    return line;
  }
  const special = ejson(value as Record<string, unknown>);
  if (special) {
    line.append(h('span.tog'), ...keyEl, h('span.oid.v', null, special), comma);
    return line;
  }
  const isArr = Array.isArray(value);
  const entries: [string, unknown][] = isArr ? (value as unknown[]).map((v, i) => [String(i), v]) : Object.entries(value as object);
  const [open, close] = isArr ? ['[', ']'] : ['{', '}'];
  if (!entries.length) {
    line.append(h('span.tog'), ...keyEl, h('span.v', null, `${open}${close}`), comma);
    return line;
  }
  const wrap = h('div');
  const tog = h('span.tog', null, '▾');
  const idEntry = !isArr ? entries.find(([k]) => k === '_id') : undefined;
  const summary = isArr
    ? `${entries.length} items`
    : idEntry
      ? `_id: ${ejson(idEntry[1] as Record<string, unknown>) ?? JSON.stringify(idEntry[1])} · ${entries.length} keys`
      : `${entries.length} keys`;
  const preview = h('span.p', null, ` ${summary} `);
  line.append(tog, ...keyEl, open, preview);
  const kids = h('div.jc');
  const tail = h('div.jl', null, h('span.tog'), `${close}${comma}`);
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    entries.slice(0, MAX_CHILDREN).forEach(([k, v], i) => {
      const child = node(isArr ? undefined : k, v, [...path, isArr ? i : k], expandDepth, i === entries.length - 1, opts);
      if (isArr && !depth) opts.item?.(child, i);
      kids.appendChild(child);
    });
    if (entries.length > MAX_CHILDREN) kids.appendChild(h('div.jl.p', null, `… ${entries.length - MAX_CHILDREN} more`));
  };
  const stateKey = opts.open && opts.key ? opts.key(path) : undefined;
  const set = (open_: boolean) => {
    if (open_) build();
    kids.classList.toggle('hidden', !open_);
    tail.classList.toggle('hidden', !open_);
    preview.textContent = open_ ? '' : ` ${summary} ${close}${comma}`;
    tog.textContent = open_ ? '▾' : '▸';
  };
  const toggle = (open_: boolean) => {
    set(open_);
    if (stateKey !== undefined) opts.open!.set(stateKey, open_);
  };
  tog.addEventListener('click', () => toggle(kids.classList.contains('hidden')));
  preview.addEventListener('click', () => toggle(true));
  set((stateKey !== undefined ? opts.open!.get(stateKey) : undefined) ?? depth < expandDepth);
  wrap.append(line, kids, tail);
  return wrap;
}

function scalar(v: unknown): HTMLElement {
  if (v === null) return h('span.z.v', null, 'null');
  if (v === undefined) return h('span.z.v', null, 'undefined');
  if (typeof v === 'number' || typeof v === 'bigint') return h('span.n.v', null, String(v));
  if (typeof v === 'boolean') return h('span.b.v', null, String(v));
  return h('span.s.v', null, JSON.stringify(v));
}

function ejson(v: Record<string, unknown>): string | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const keys = Object.keys(v);
  if (keys.length !== 1) return undefined;
  const k = keys[0];
  const x = v[k];
  if (k === '$oid') return `ObjectId("${x}")`;
  if (k === '$date') return `ISODate("${typeof x === 'object' && x ? (x as { $numberLong?: string }).$numberLong : x}")`;
  if (k === '$numberLong' || k === '$numberDecimal' || k === '$numberDouble') return `${k.slice(7)}("${x}")`;
  if (k === '$uuid') return `UUID("${x}")`;
  return undefined;
}
