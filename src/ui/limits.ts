/**
 * The settings orca saves beside the plugin.
 *
 * A book's design lives in the book's note. These are the machine's:
 * how much of the engine orca keeps running on it.
 */

import { CEILING } from "@/engine/pool";

export interface Limits {
  /** Books kept on the engine at once. */
  books: number;
}

export const LIMITS: Limits = { books: CEILING };

/** The most books the setting offers to keep on the engine. */
export const MOST_BOOKS = 8;

/** The limits `loadData` gave back, with the defaults under them. */
export function readLimits(saved: unknown): Limits {
  if (typeof saved !== "object" || saved === null || !("books" in saved)) {
    return { ...LIMITS };
  }
  const { books } = saved;
  return {
    books: typeof books === "number" ? bookCount(books) : LIMITS.books,
  };
}

/** `books`, in whole books and inside the range the setting offers. */
export function bookCount(books: number): number {
  if (!Number.isFinite(books)) return LIMITS.books;
  return Math.min(Math.max(Math.floor(books), 1), MOST_BOOKS);
}
