/**
 * What names the book, split between the engine and orca.
 *
 * The engine's PDF writer is the one thing that reads metadata, and it
 * writes title, author, language and date into the document's own
 * information. The rest is orca's to set.
 */

import type { Metadata } from "fleuron";
import type { Book } from "@/book/note";

/** Publisher, series and isbn, which orca sets on the page it generates. */
export interface Imprint {
  publisher?: string;
  series?: string;
  isbn?: string;
}

/**
 * What crosses to the engine. It travels after the sources, which leave
 * a book of several notes unnamed.
 */
export function documentMetadata(book: Book): Metadata {
  const { title, author, language, date } = book.metadata;
  const metadata: Metadata = {};
  if (title !== undefined) metadata.title = title;
  if (author !== undefined) metadata.author = author;

  const extra: Record<string, string> = {};
  if (language !== undefined) extra.language = language;
  if (date !== undefined) extra.date = date;
  if (Object.keys(extra).length > 0) metadata.extra = extra;

  return metadata;
}

/** What the engine carries none of, and orca sets itself. */
export function imprint(book: Book): Imprint {
  const { publisher, series, isbn } = book.metadata;
  const held: Imprint = {};
  if (publisher !== undefined) held.publisher = publisher;
  if (series !== undefined) held.series = series;
  if (isbn !== undefined) held.isbn = isbn;
  return held;
}
