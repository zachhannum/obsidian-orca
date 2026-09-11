/**
 * The settings orca saves beside the plugin.
 *
 * The design of a book lives in the note of the book. These settings
 * belong to the machine.
 */

import { CEILING } from "@/engine/pool";
import { PAGE_UNITS, type PageUnit } from "@/style/design";

export interface Limits {
  /** The most books orca keeps on engines at once. */
  books: number;
  /** The unit the design panel draws the margins and a custom trim in. */
  unit: PageUnit;
}

export const LIMITS: Limits = { books: CEILING, unit: "in" };

/** The most books the setting offers to keep on engines. */
export const MOST_BOOKS = 8;

/** Reads the limits `loadData` gave back, and fills in the defaults. */
export function readLimits(saved: unknown): Limits {
  if (typeof saved !== "object" || saved === null) return { ...LIMITS };
  const books = "books" in saved ? saved.books : undefined;
  const unit = "unit" in saved ? saved.unit : undefined;
  return {
    books: typeof books === "number" ? bookCount(books) : LIMITS.books,
    unit: isPageUnit(unit) ? unit : LIMITS.unit,
  };
}

/** Rounds `books` to a whole number inside the range the setting offers. */
export function bookCount(books: number): number {
  if (!Number.isFinite(books)) return LIMITS.books;
  return Math.min(Math.max(Math.floor(books), 1), MOST_BOOKS);
}

export function isPageUnit(value: unknown): value is PageUnit {
  return (PAGE_UNITS as readonly unknown[]).includes(value);
}
