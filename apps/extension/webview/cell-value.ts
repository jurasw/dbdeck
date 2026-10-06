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
  const value: unknown = JSON.parse(text);
  if (typeof original === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Enter a valid number');
  if (typeof original === 'boolean' && typeof value !== 'boolean') throw new Error('Enter true or false');
  return value;
}
