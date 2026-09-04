/**
 * A book note in memory: the book its properties hold, and the reading
 * order its body holds.
 *
 * The view holds one of these and paints from it. The note is written
 * back in two halves, so an edit to one leaves the other as the author
 * wrote it.
 */

import { readFrontmatter } from "@/book/frontmatter";
import { readBook, writeNote, type Book } from "@/book/note";
import { readOrder, writeOrder, type Order } from "@/book/order";

/** A book note, read whole. */
export interface Model {
  book: Book;
  order: Order;
}

/**
 * The book a note's text holds. A note orca does not read comes back as
 * a `BookError`.
 */
export function readModel(text: string): Model {
  const { properties, body } = readFrontmatter(text);
  return { book: readBook(properties), order: readOrder(body) };
}

/** A whole book note as text, which is how a new one is created. */
export function writeModel(model: Model): string {
  return writeNote(model.book, writeOrder(model.order));
}

/**
 * The note with this reading order in place of the one it holds. The
 * properties are left byte for byte as they are on disk, because they
 * are written through Obsidian's own frontmatter API.
 */
export function withOrder(text: string, order: Order): string {
  const { body } = readFrontmatter(text);
  return text.slice(0, text.length - body.length) + writeOrder(order);
}
