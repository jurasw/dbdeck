export function parseCellValue(text: string | null, original: unknown): unknown {
  if (text === null) return null;
  if (typeof original === 'string') return text;
  if (original === null || original === undefined) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (value === undefined && typeof original === 'object') throw new Error('Enter valid JSON');
  if (typeof original === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Enter a valid number');
  if (typeof original === 'boolean' && typeof value !== 'boolean') throw new Error('Enter true or false');
  return value;
}
