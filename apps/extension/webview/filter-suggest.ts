export type FieldValue = string | number | boolean;

export interface FieldHint {
  name: string;
  type: string;
  values?: FieldValue[];
}

export interface Suggestion {
  label: string;
  detail: string;
  text: string;
  caret: number;
}

const KEY_CONTEXT = /(^\s*|[{,]\s*)("?)([\w.$-]*)$/;
const VALUE_CONTEXT = /"([^"]+)"\s*:\s*("?)([^",{}[\]]*)$/;
const PARTIAL_TOKEN = /^[\w.$-]*"?/;

export function filterSuggestions(text: string, caret: number, fields: FieldHint[], limit = 12): Suggestion[] {
  const before = text.slice(0, caret);
  const tail = text.slice(caret).replace(PARTIAL_TOKEN, '');
  const value = VALUE_CONTEXT.exec(before);
  if (value) {
    const field = fields.find((f) => f.name === value[1]);
    if (!field) return [];
    const start = caret - value[2].length - value[3].length;
    return rank(choices(field), value[3], (c) => String(c.value))
      .slice(0, limit)
      .map((c) => complete(text.slice(0, start), c.text, c.offset, tail, `${field.name} = ${c.text}`, field.type));
  }
  const key = KEY_CONTEXT.exec(before);
  if (!key) return [];
  const start = caret - key[2].length - key[3].length;
  const head = text.slice(0, start);
  return rank(fields, key[3], (f) => f.name)
    .flatMap((f) =>
      choices(f).map((c) => {
        const entry = `${JSON.stringify(f.name)}: ${c.text}`;
        return complete(head, entry, entry.length - c.text.length + c.offset, tail, `${f.name} = ${c.text}`, f.type);
      }),
    )
    .slice(0, limit);
}

interface Choice {
  value: unknown;
  text: string;
  offset: number;
}

function choices(field: FieldHint): Choice[] {
  const types = field.type.split(' | ');
  const values: FieldValue[] = [...(types.includes('boolean') ? [true, false] : []), ...(field.values ?? []).filter((v) => typeof v !== 'boolean')];
  if (values.length) return values.map((v) => ({ value: v, text: JSON.stringify(v), offset: JSON.stringify(v).length }));
  const placeholder = PLACEHOLDERS[types[0]] ?? ['', 0];
  return [{ value: '', text: placeholder[0], offset: placeholder[1] }];
}

const PLACEHOLDERS: Record<string, [string, number]> = {
  string: ['""', 1],
  number: ['0', 1],
  null: ['null', 4],
  date: ['{ "$date": "" }', 12],
  ObjectId: ['{ "$oid": "" }', 11],
  array: ['{ "$in": [] }', 10],
  object: ['{ "$exists": true }', 19],
};

function rank<T>(items: T[], prefix: string, name: (item: T) => string): T[] {
  const p = prefix.toLowerCase();
  const starts = items.filter((i) => name(i).toLowerCase().startsWith(p));
  const contains = p ? items.filter((i) => !name(i).toLowerCase().startsWith(p) && name(i).toLowerCase().includes(p)) : [];
  return [...starts, ...contains];
}

function complete(head: string, insert: string, offset: number, tail: string, label: string, detail: string): Suggestion {
  const open = !head.trim();
  const prefix = open ? '{ ' : head;
  const separator = /^\s*"/.test(tail) ? ', ' : '';
  const body = prefix + insert + separator + tail;
  const missing = unclosedBraces(body);
  return {
    label,
    detail,
    text: body.trimEnd() + ' }'.repeat(missing),
    caret: prefix.length + offset,
  };
}

function unclosedBraces(text: string): number {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '\\') i++;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return depth;
}

export interface SqlColumn {
  name: string;
  type?: string;
  nullable?: boolean;
}

const SQL_KEY_CONTEXT = /(^|\(|\s(?:and|or|not)\s+|^\s*not\s+)\s*([\w$]*)$/i;

export function sqlSuggestions(text: string, caret: number, columns: SqlColumn[], ident: (name: string) => string, booleanBits = false, limit = 12): Suggestion[] {
  const before = text.slice(0, caret);
  const key = SQL_KEY_CONTEXT.exec(before);
  if (!key) return [];
  const start = caret - key[2].length;
  const head = text.slice(0, start);
  const tail = text.slice(caret).replace(/^[\w$]*/, '');
  return rank(columns, key[2], (c) => c.name)
    .flatMap((c) =>
      sqlChoices(c, booleanBits).map((choice) => {
        const insert = `${ident(c.name)} ${choice.text}`;
        const spaced = tail && !/^\s/.test(tail) ? ' ' : '';
        return {
          label: `${c.name} ${choice.text}`,
          detail: c.type ?? '',
          text: head + insert + spaced + tail,
          caret: head.length + insert.length - choice.text.length + choice.offset,
        };
      }),
    )
    .slice(0, limit);
}

function sqlChoices(column: SqlColumn, booleanBits: boolean): { text: string; offset: number }[] {
  const type = (column.type ?? '').toLowerCase();
  const at = (text: string, offset = text.length) => ({ text, offset });
  const nulls = column.nullable ? [at('IS NULL'), at('IS NOT NULL')] : [];
  if (/^(bool|boolean)$/.test(type)) return [at('= true'), at('= false'), ...nulls];
  if (type === 'bit' || (booleanBits && /^tinyint\(1\)$/.test(type))) return [at('= 1'), at('= 0'), ...nulls];
  if (/date|time/.test(type)) return [at(">= ''", 4), ...nulls];
  if (/char|text|string|uuid|enum|clob/.test(type)) return [at("= ''", 3), at("LIKE '%%'", 7), ...nulls];
  return [at('= '), ...nulls];
}
