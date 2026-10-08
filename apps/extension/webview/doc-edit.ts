import { parseCellValue } from './cell-value';

export type DocPath = (string | number)[];
type Doc = Record<string, unknown>;
type Container = Record<string, unknown> | unknown[];

export type DocWrite = { field: string; value: unknown } | { doc: Doc };

const wrapperKey = (v: unknown): string | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0].startsWith('$') && typeof (v as Doc)[keys[0]] === 'string' ? keys[0] : undefined;
};

export function valueAt(doc: unknown, path: DocPath): unknown {
  return path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Doc)[k as string] : undefined), doc);
}

export function editText(value: unknown): string {
  const wrapper = wrapperKey(value);
  if (wrapper) return (value as Doc)[wrapper] as string;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return JSON.stringify(value) ?? '';
}

export function parseEdit(text: string, original: unknown): unknown {
  const wrapper = wrapperKey(original);
  if (wrapper) return { [wrapper]: text.trim() };
  if (original !== null && typeof original === 'object') return JSON.parse(text);
  return parseCellValue(text, original);
}

function edit(doc: Doc, path: DocPath, change: (parent: Container, key: string | number) => void): Doc {
  if (!path.length) throw new Error('Select a field');
  if (path[0] === '_id') throw new Error('_id cannot be changed');
  const copy = structuredClone(doc);
  const parent = valueAt(copy, path.slice(0, -1));
  if (!parent || typeof parent !== 'object') throw new Error('Field not found');
  change(parent as Container, path[path.length - 1]);
  return copy;
}

export function setValue(doc: Doc, path: DocPath, value: unknown): Doc {
  return edit(doc, path, (parent, key) => ((parent as Doc)[key as string] = value));
}

export function removeValue(doc: Doc, path: DocPath): Doc {
  return edit(doc, path, (parent, key) => (Array.isArray(parent) ? parent.splice(key as number, 1) : delete parent[key as string]));
}

export function renameField(doc: Doc, path: DocPath, name: string): Doc {
  return edit(doc, path, (parent, key) => {
    if (Array.isArray(parent)) throw new Error('Array items have no name');
    if (!name || name.startsWith('$') || name.includes('.') || name.includes('\0') || (path.length === 1 && name === '_id')) throw new Error('Enter a valid field name');
    if (name === key) return;
    if (name in parent) throw new Error(`Field "${name}" already exists`);
    const entries = Object.entries(parent).map(([k, v]) => [k === key ? name : k, v] as const);
    for (const k of Object.keys(parent)) delete parent[k];
    for (const [k, v] of entries) parent[k] = v;
  });
}

export function addValue(doc: Doc, path: DocPath, name: string | undefined, value: unknown): Doc {
  return edit(doc, [...path, name ?? 0], (parent) => {
    if (Array.isArray(parent)) return void parent.push(value);
    if (!name || name.startsWith('$') || name.includes('.') || name.includes('\0') || name === '_id') throw new Error('Enter a valid field name');
    if (name in parent) throw new Error(`Field "${name}" already exists`);
    parent[name] = value;
  });
}

export function planWrite(before: Doc, after: Doc): DocWrite | null {
  const a = Object.keys(before);
  const b = Object.keys(after);
  const changed = b.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const sameKeys = a.length === b.length && a.every((k, i) => b[i] === k);
  const appended = b.length === a.length + 1 && a.every((k, i) => b[i] === k);
  if (sameKeys && !changed.length) return null;
  if ((sameKeys || appended) && changed.length === 1 && changed[0] !== '_id') return { field: changed[0], value: after[changed[0]] };
  return { doc: after };
}
