/**
 * The book's metadata, split between what the engine writes and what
 * orca sets.
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
 * The metadata sent to the engine. It travels after the sources, which
 * leave a book of several notes unnamed.
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

/** The metadata the engine does not read, which orca sets itself. */
export function imprint(book: Book): Imprint {
  const { publisher, series, isbn } = book.metadata;
  const fields: Imprint = {};
  if (publisher !== undefined) fields.publisher = publisher;
  if (series !== undefined) fields.series = series;
  if (isbn !== undefined) fields.isbn = isbn;
  return fields;
}
