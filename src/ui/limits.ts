/**
 * The settings orca saves beside the plugin.
 *
 * The design of a book lives in the note of the book. These settings
 * belong to the machine.
 */

import { CEILING } from "@/engine/pool";
import { PAGE_UNITS, type PageUnit } from "@/style/design";
import { isViewMode, type ViewMode } from "@/ui/page";

export interface Limits {
  /** The most books orca keeps typeset at once. */
  sessions: number;
  /** The unit the design panel draws the margins and a custom trim in. */
  unit: PageUnit;
  /**
   * The view the last preview was switched to, which the next one
   * opens in. A pane restored with the workspace keeps its own.
   */
  view: ViewMode;
  /** Whether the navigator lists the headings inside each entry's note. */
  headings: boolean;
  /** The deepest heading level the navigator lists, from 1 to 6. */
  deepest: number;
}

/** The deepest heading level Markdown writes. */
export const DEEPEST_LEVEL = 6;

export const LIMITS: Limits = {
  sessions: CEILING,
  unit: "in",
  view: "single",
  headings: false,
  deepest: DEEPEST_LEVEL,
};

/** The most sessions the setting offers to keep. */
export const MOST_SESSIONS = 8;

/**
 * Reads the limits `loadData` gave back, and fills in the defaults. A
 * file saved under the old `books` key reads as the same number.
 */
export function readLimits(saved: unknown): Limits {
  if (typeof saved !== "object" || saved === null) return { ...LIMITS };
  const kept = "sessions" in saved ? saved.sessions : undefined;
  const older = "books" in saved ? saved.books : undefined;
  const sessions = kept ?? older;
  const unit = "unit" in saved ? saved.unit : undefined;
  const view = "view" in saved ? saved.view : undefined;
  const headings = "headings" in saved ? saved.headings : undefined;
  const deepest = "deepest" in saved ? saved.deepest : undefined;
  return {
    sessions:
      typeof sessions === "number" ? sessionCount(sessions) : LIMITS.sessions,
    unit: isPageUnit(unit) ? unit : LIMITS.unit,
    view: isViewMode(view) ? view : LIMITS.view,
    headings: typeof headings === "boolean" ? headings : LIMITS.headings,
    deepest: typeof deepest === "number" ? headingLevel(deepest) : LIMITS.deepest,
  };
}

/** Rounds `sessions` to a whole number inside the range the setting offers. */
export function sessionCount(sessions: number): number {
  if (!Number.isFinite(sessions)) return LIMITS.sessions;
  return Math.min(Math.max(Math.floor(sessions), 1), MOST_SESSIONS);
}

/** Rounds `level` to a whole heading level from 1 to 6. */
export function headingLevel(level: number): number {
  if (!Number.isFinite(level)) return LIMITS.deepest;
  return Math.min(Math.max(Math.floor(level), 1), DEEPEST_LEVEL);
}

export function isPageUnit(value: unknown): value is PageUnit {
  return (PAGE_UNITS as readonly unknown[]).includes(value);
}
