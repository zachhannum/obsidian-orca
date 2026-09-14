/**
 * The place a warning names. The engine reports it as one string, and
 * orca reads places from the engine. Orca borrows the editor's CSS
 * grammar to read names only, never to judge whether CSS is valid.
 */

/** A line and column in one named sheet or note, both counted from 1. */
export interface Place {
  sheet: string;
  line: number;
  column: number;
}

/**
 * Reads `name:line:column` from the right, since a name may hold a
 * colon of its own. Nothing when the origin names no line and column.
 */
export function readOrigin(origin: string): Place | undefined {
  const found = /^(.+):(\d+):(\d+)$/.exec(origin);
  if (found === null) return undefined;
  const [, sheet, line, column] = found;
  if (sheet === undefined || line === undefined || column === undefined) return undefined;
  return { sheet, line: Number(line), column: Number(column) };
}
