/**
 * The place a warning names. The engine reports it as one string, and
 * reading that string is the only piece of CSS knowledge orca owns: the
 * engine is the only linter, so orca carries no grammar of its own.
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
