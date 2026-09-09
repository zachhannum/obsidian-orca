/**
 * The settings orca saves beside the plugin.
 *
 * The design of a book lives in the note of the book. These settings
 * belong to the machine: how much of the engine orca runs on it.
 */

import { CEILING } from "@/engine/pool";

export interface Limits {
  /** The most books orca keeps on engines at once. */
  books: number;
}

export const LIMITS: Limits = { books: CEILING };

/** The most books the setting offers to keep on engines. */
export const MOST_BOOKS = 8;

/** Reads the limits `loadData` gave back, and fills in the defaults. */
export function readLimits(saved: unknown): Limits {
  if (typeof saved !== "object" || saved === null || !("books" in saved)) {
    return { ...LIMITS };
  }
  const { books } = saved;
  return {
    books: typeof books === "number" ? bookCount(books) : LIMITS.books,
  };
}

/** Rounds `books` to a whole number inside the range the setting offers. */
export function bookCount(books: number): number {
  if (!Number.isFinite(books)) return LIMITS.books;
  return Math.min(Math.max(Math.floor(books), 1), MOST_BOOKS);
}
