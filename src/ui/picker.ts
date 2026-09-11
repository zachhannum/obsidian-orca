/**
 * The font picker, without its drawing.
 *
 * The picker offers only fonts in the index, so a font cannot be
 * misspelled into a book. Typing filters the list, and a string that
 * matches nothing commits nothing.
 */

import { has, matching, type Family, type FontIndex } from "@/assets/fonts";

/** The picker's state. */
export interface Picking {
  /** The fonts the typed string matches, in the order they are offered. */
  offered: Family[];
  /** The selected row, clamped to the offered list, or -1 for none. */
  at: number;
  /** The font a commit takes, or nothing when nothing matches. */
  commits: Family | undefined;
}

/**
 * Filters the index by a typed string and clamps the selected row to
 * the result. A row past the end of a narrowed list lands on its last
 * row.
 */
export function picking(index: FontIndex, typed: string, at: number): Picking {
  const offered = matching(index, typed);
  if (offered.length === 0) return { offered, at: -1, commits: undefined };
  const on = Math.min(Math.max(at, 0), offered.length - 1);
  return { offered, at: on, commits: offered[on] };
}

/**
 * The warning for a book set in a font the machine does not have. The
 * engine sets the book in the one it carries and returns no warning
 * for the missing one.
 */
export function missingFont(
  index: FontIndex,
  font: string | undefined,
): string | undefined {
  if (font === undefined || has(index, font)) return undefined;
  return `${font} is not a font this machine has. The book is set in the one orca carries.`;
}
