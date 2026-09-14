/**
 * A string as CSS. A font name comes from a font file's own name
 * table, and an ornament comes from the author. A quote or a backslash
 * in either one is escaped.
 */
export function quoted(text: string): string {
  return `"${text.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}
