/**
 * The face picker, without its drawing.
 *
 * The picker offers only families in the index, so a family cannot be
 * misspelled into a book. Typing filters the list, and a string that
 * matches nothing commits nothing.
 *
 * The styles beside a chosen family come from the engine. A variable
 * file's cuts are not in its name table.
 */

import type { FontRefEntry } from "fleuron";
import { has, matching, type Family, type FontIndex } from "@/assets/fonts";

/** The picker's state. */
export interface Picking {
  /** The families the typed string matches, in the order they are offered. */
  offered: Family[];
  /** The selected row, clamped to the offered list, or -1 for none. */
  at: number;
  /** The family a commit takes, or nothing when nothing matches. */
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

/** One cut of a family, as the engine registered it. */
export interface Cut {
  /** The id the engine gave this cut, which the painter draws by. */
  id: number;
  entry: FontRefEntry;
}

/**
 * The cuts of a family, by the ids the engine gave them. A family the
 * engine has no face for has no cuts.
 */
export function cuts(faces: readonly FontRefEntry[], family: string): Cut[] {
  const named = family.toLowerCase();
  const found: Cut[] = [];
  for (const [id, entry] of faces.entries()) {
    if (entry.family === named) found.push({ id, entry });
  }
  return found;
}

/**
 * The warning for a book set in a family the machine does not have.
 * The engine sets the book in the face it carries and returns no
 * warning for the missing one.
 */
export function missingFace(
  index: FontIndex,
  family: string | undefined,
): string | undefined {
  if (family === undefined || has(index, family)) return undefined;
  return `${family} is not a face this machine has. The book is set in the one orca carries.`;
}
