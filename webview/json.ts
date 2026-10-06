import { h } from './lib';

const MAX_CHILDREN = 500;

export function jsonView(value: unknown, expandDepth = 2): HTMLElement {
  const root = h('div.json');
  root.appendChild(node(undefined, value, 0, expandDepth, true));
  return root;
}

function node(key: string | undefined, value: unknown, depth: number, expandDepth: number, last: boolean): HTMLElement {
  const line = h('div.jl');
  const keyEl = key !== undefined ? [h('span.k', null, JSON.stringify(key)), ': '] : [];
  const comma = last ? '' : ',';
  if (value === null || typeof value !== 'object') {
    line.append(h('span.tog'), ...keyEl, scalar(value), comma);
    return line;
  }
  const special = ejson(value as Record<string, unknown>);
  if (special) {
    line.append(h('span.tog'), ...keyEl, h('span.oid', null, special), comma);
    return line;
  }
  const isArr = Array.isArray(value);
  const entries: [string, unknown][] = isArr ? (value as unknown[]).map((v, i) => [String(i), v]) : Object.entries(value as object);
  const [open, close] = isArr ? ['[', ']'] : ['{', '}'];
  if (!entries.length) {
    line.append(h('span.tog'), ...keyEl, `${open}${close}${comma}`);
    return line;
  }
  const wrap = h('div');
  const tog = h('span.tog', null, '▾');
  const preview = h('span.p', null, ` ${isArr ? `${entries.length} items` : `${entries.length} keys`} `);
  const head = h('div.jl', null, tog, ...keyEl, open, preview);
  const kids = h('div.jc');
  const tail = h('div.jl', null, h('span.tog'), `${close}${comma}`);
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    entries.slice(0, MAX_CHILDREN).forEach(([k, v], i) => kids.appendChild(node(isArr ? undefined : k, v, depth + 1, expandDepth, i === entries.length - 1)));
    if (entries.length > MAX_CHILDREN) kids.appendChild(h('div.jl.p', null, `… ${entries.length - MAX_CHILDREN} more`));
  };
  const set = (open_: boolean) => {
    if (open_) build();
    kids.classList.toggle('hidden', !open_);
    tail.classList.toggle('hidden', !open_);
    preview.textContent = open_ ? '' : ` ${isArr ? `${entries.length} items` : `${entries.length} keys`} ${close}${comma}`;
    tog.textContent = open_ ? '▾' : '▸';
  };
  tog.addEventListener('click', () => set(kids.classList.contains('hidden')));
  preview.addEventListener('click', () => set(true));
  set(depth < expandDepth);
  wrap.append(head, kids, tail);
  return wrap;
}

function scalar(v: unknown): HTMLElement {
  if (v === null) return h('span.z', null, 'null');
  if (v === undefined) return h('span.z', null, 'undefined');
  if (typeof v === 'number' || typeof v === 'bigint') return h('span.n', null, String(v));
  if (typeof v === 'boolean') return h('span.b', null, String(v));
  return h('span.s', null, JSON.stringify(v));
}

function ejson(v: Record<string, unknown>): string | undefined {
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
