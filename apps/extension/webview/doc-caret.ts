export function fieldCaret(text: string, key: string): number {
  const label = `${JSON.stringify(key)}: `;
  const top = text.indexOf(`\n  ${label}`);
  const at = top >= 0 ? top + 3 : text.indexOf(label);
  return at < 0 ? 0 : at + label.length;
}
