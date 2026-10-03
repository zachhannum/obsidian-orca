/**
 * The book page's report: the properties orca owns as fields the page
 * edits, and the reading order with a word count beside each entry.
 *
 * The reading order is drawn here and edited in the navigator. Every
 * line names its entry by its place, which is what the navigator is
 * asked to focus.
 */

import { coverUrl } from "@/book/images";
import type { Links } from "@/book/links";
import type { Model } from "@/book/model";
import { FIELD_KEYS, type BookMetadata } from "@/book/note";
import { resolve } from "@/book/order";
import type { Range } from "@/book/pages";
import { DEFAULT_ROLE } from "@/book/roles";
import { bookName, row, type Opened, type Row } from "@/ui/shelf";

/** One property orca owns, as the page edits it. A property the note does not have is empty. */
export interface Field {
  key: keyof BookMetadata;
  value: string;
}

/** One entry in the reading order, with the word count of its note. */
export interface Line extends Row {
  /** The note's word count, or nothing for an entry with no note or a note not yet counted. */
  words?: number;
  /** The folio range its content lands on, once a run reaches it. */
  pages?: Range;
}

/**
 * The book's cover as the page draws it. A cover that names no image in
 * the vault keeps what the author wrote, so the page can say what is
 * missing.
 */
export type Cover =
  | { kind: "none" }
  | { kind: "image"; path: string }
  | { kind: "missing"; written: string };

export interface Report {
  /** The book's title, or the note's name when it has none. */
  name: string;
  format: number;
  /** The number of entries in the default role. */
  chapters: number;
  /** The words in every note the book reads, summed. */
  words: number;
  /** Every property the page edits as text, which leaves out the cover. */
  fields: Field[];
  cover: Cover;
  lines: Line[];
}

/** The vault, as much of it as the report reads. */
export interface Counting {
  links: Links;
  /** A note's word count, or nothing while the note is still being counted. */
  words(path: string): number | undefined;
}

/**
 * The report for one book note, resolved against the vault. `ranges`
 * is the last run's own; an entry it has not reached, or no run yet,
 * names no range.
 */
export function report(
  book: Opened,
  vault: Counting,
  ranges: Map<number, Range> = new Map(),
): Report {
  const { metadata } = book.model.book;
  const { sections } = resolve(book.model.order, vault.links, book.path);
  const lines = sections.map((section, at): Line => {
    const line: Line = row(section, at);
    if (section.kind === "note") {
      const words = vault.words(section.path);
      if (words !== undefined) line.words = words;
    }
    const range = ranges.get(at);
    if (range !== undefined) line.pages = range;
    return line;
  });
  return {
    name: bookName(book),
    format: book.model.book.format,
    chapters: lines.filter((line) => line.role === DEFAULT_ROLE).length,
    words: lines.reduce((sum, line) => sum + (line.words ?? 0), 0),
    fields: FIELD_KEYS.filter((key) => key !== "cover").map((key) => ({
      key,
      value: metadata[key] ?? "",
    })),
    cover: coverOf(book, vault.links),
    lines,
  };
}

/** The cover a book names, resolved the way the engine's copy of it is. */
export function coverOf(book: Opened, links: Links): Cover {
  const written = coverUrl(book.model.book);
  if (written === undefined) return { kind: "none" };
  const path = links.find(written, book.path);
  return path === undefined || path.endsWith(".md")
    ? { kind: "missing", written }
    : { kind: "image", path };
}

/** The extensions of the images the engine reads. */
const PICTURES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

/** A vault path the picker offers as a cover. */
export function pictured(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && PICTURES.has(path.slice(dot + 1).toLowerCase());
}

/**
 * The vault path a drag from Obsidian's file explorer carries. The
 * explorer writes an `obsidian://open` url, and the path is its `file`.
 * A drag of several files gives the first.
 */
export function carriedPath(carried: string): string | undefined {
  const [first = ""] = carried.trim().split(/\s+/);
  if (!URL.canParse(first)) return undefined;
  const url = new URL(first);
  if (url.protocol !== "obsidian:") return undefined;
  return url.searchParams.get("file") ?? undefined;
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

/** A folio range, as `147` for one page or `147–159` for a span. */
export function foliate(range: Range): string {
  return range.first === range.last
    ? String(range.first)
    : `${range.first}–${range.last}`;
}
