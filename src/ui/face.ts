/**
 * The face picker, as much of it as is not drawing.
 *
 * The picker offers the index and nothing else, so a family cannot be
 * misspelled into a book. Typing filters what is offered rather than
 * naming a family, and a string matching nothing commits nothing.
 *
 * The styles beside a chosen family are the engine's answer, not a
 * second reading of the name table: a variable file names cuts the
 * file itself does not list.
 */

import type { FontRefEntry } from "fleuron";
import { has, matching, type Family, type FontIndex } from "@/assets/fonts";

/** The picker as the view holds it. */
export interface Picking {
  /** The families the typed string matches, in the order they are offered. */
  offered: Family[];
  /** The row the keys are on, clamped to what is offered, or -1 for none. */
  at: number;
  /** The family a commit would take. Nothing when nothing matches. */
  commits: Family | undefined;
}

/**
 * The picker's offer for a typed string, and where the keys are in it.
 * A row index past the end of a narrowed list lands on its last row
 * rather than off it.
 */
export function picking(index: FontIndex, typed: string, at: number): Picking {
  const offered = matching(index, typed);
  if (offered.length === 0) return { offered, at: -1, commits: undefined };
  const on = Math.min(Math.max(at, 0), offered.length - 1);
  return { offered, at: on, commits: offered[on] };
}

/** One cut of a family, as the engine registered it. */
export interface Cut {
  /** The id the engine gave this cut, which the painter draws it by. */
  id: number;
  entry: FontRefEntry;
}

/**
 * The cuts a family is set from, by the ids the engine gave them. A
 * family the engine has no face for has no cuts, which is what a book
 * naming a face the machine does not have comes back as.
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
 * The warning a book naming a family the machine does not have
 * raises. The engine sets the book in the face it carries and says
 * nothing about the one it was asked for, so this is orca's to notice.
 */
export function missingFace(
  index: FontIndex,
  family: string | undefined,
): string | undefined {
  if (family === undefined || has(index, family)) return undefined;
  return `${family} is not a face this machine has. The book is set in the one orca carries.`;
}
