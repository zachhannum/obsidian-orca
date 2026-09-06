/**
 * The book page's report: the properties orca owns as fields the page
 * edits, and the reading order with a word count beside each entry.
 *
 * The reading order is drawn here and edited in the navigator. Every
 * line names its entry by its place, which is what the navigator is
 * asked to focus.
 */

import type { Links } from "@/book/links";
import type { Model } from "@/book/model";
import { FIELD_KEYS, type BookMetadata } from "@/book/note";
import { resolve } from "@/book/order";
import { DEFAULT_ROLE } from "@/book/roles";
import { row, type Opened, type Row } from "@/ui/shelf";

/** One property orca owns, as the page edits it. A property the note does not have is empty. */
export interface Field {
  key: keyof BookMetadata;
  value: string;
}

/** One entry in the reading order, with the word count of its note. */
export interface Line extends Row {
  /** The note's word count, or nothing for an entry with no note or a note not yet counted. */
  words?: number;
}

export interface Report {
  /** The book's title, or the note's name when it has none. */
  name: string;
  format: number;
  /** The number of entries in the default role. */
  chapters: number;
  /** The words in every note the book reads, summed. */
  words: number;
  fields: Field[];
  lines: Line[];
}

/** The vault, as much of it as the report reads. */
export interface Counting {
  links: Links;
  /** A note's word count, or nothing while the note is still being counted. */
  words(path: string): number | undefined;
}

/** The report for one book note, resolved against the vault. */
export function report(book: Opened, vault: Counting): Report {
  const { metadata } = book.model.book;
  const { sections } = resolve(book.model.order, vault.links, book.path);
  const lines = sections.map((section, at): Line => {
    const line: Line = row(section, at);
    if (section.kind !== "note") return line;
    const words = vault.words(section.path);
    if (words !== undefined) line.words = words;
    return line;
  });
  return {
    name: metadata.title ?? book.name,
    format: book.model.book.format,
    chapters: lines.filter((line) => line.role === DEFAULT_ROLE).length,
    words: lines.reduce((sum, line) => sum + (line.words ?? 0), 0),
    fields: FIELD_KEYS.map((key) => ({ key, value: metadata[key] ?? "" })),
    lines,
  };
}

/**
 * The model with one property set. An empty value takes the property
 * off the note rather than writing an empty one.
 */
export function setField(
  model: Model,
  key: keyof BookMetadata,
  value: string,
): Model {
  const metadata = { ...model.book.metadata };
  if (value === "") delete metadata[key];
  else metadata[key] = value;
  return { ...model, book: { ...model.book, metadata } };
}
