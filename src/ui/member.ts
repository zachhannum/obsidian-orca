/**
 * The book a note belongs to.
 *
 * A chapter carries no mark of its own, so membership is read from the
 * other end: every book's reading order, resolved against the vault. A
 * note two books read belongs to the first of them, which is the book
 * a toggle from that note opens.
 */

import type { Links } from "@/book/links";
import { resolve } from "@/book/order";
import type { Opened } from "@/ui/shelf";

/** The book a note belongs to, and where it sits in the reading order. */
export interface Member {
  /** The book note's vault path. */
  book: string;
  /** The note's place in the reading order, counting from 0. */
  at: number;
}

/** Every note the books read, by its vault path. */
export function membership(books: Opened[], links: Links): Map<string, Member> {
  const found = new Map<string, Member>();
  for (const book of books) {
    const { sections } = resolve(book.model.order, links, book.path);
    for (const [at, section] of sections.entries()) {
      if (section.kind !== "note") continue;
      if (found.has(section.path)) continue;
      found.set(section.path, { book: book.path, at });
    }
  }
  return found;
}
