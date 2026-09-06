/**
 * The reading order, as the ops that cross to the engine.
 *
 * The whole order crosses as one `book` op with `split: 0`, so each
 * source is exactly one section. There is no smaller op for a
 * reorder: order is read from where a source sits in the list, so
 * moving one sends the list again.
 */

import type { Op, Source } from "fleuron";
import type { Links } from "@/book/links";
import { documentMetadata } from "@/book/metadata";
import type { Book } from "@/book/note";
import {
  entryName,
  resolve,
  type Entry,
  type Order,
  type Section,
} from "@/book/order";

/** Reads a section's note, by its vault path. `ui` implements this over the vault. */
export interface Read {
  (path: string): Promise<string>;
}

/** The prefix a generated section's name carries, so it is never read as a note's path. */
export const GENERATED_ORIGIN = "orca-generated";

/** A resolved section with something to send: a note or a generated one. */
type Sendable = Exclude<Section, { kind: "missing" }>;

/**
 * The book's reading order, as the ops that lay it out. A section
 * with no note is dropped; the warning it raised is `resolve`'s.
 */
export async function sendBook(
  book: Book,
  order: Order,
  links: Links,
  from: string,
  read: Read,
): Promise<Op[]> {
  const present = resolve(order, links, from).sections.filter(sendable);
  const sources = await Promise.all(
    present.map((section, at) => sourceOf(section, at, book, read)),
  );
  return [
    { op: "dialect", dialect: "obsidian" },
    { op: "split", level: 0 },
    { op: "book", sources },
    { op: "metadata", metadata: documentMetadata(book) },
  ];
}

function sendable(section: Section): section is Sendable {
  return section.kind !== "missing";
}

async function sourceOf(
  section: Sendable,
  at: number,
  book: Book,
  read: Read,
): Promise<Source> {
  if (section.kind === "note") {
    return { name: section.path, text: await read(section.path) };
  }
  return { name: `${GENERATED_ORIGIN}:${at}`, text: matter(section.entry, book) };
}

/**
 * A generated section's markdown. A title page takes the book's own
 * title and author; every other generated role is a heading, until
 * synthesis is a stage of its own.
 */
function matter(entry: Entry, book: Book): string {
  if (entry.role !== "title-page") return `# ${entryName(entry)}`;
  const { title, author } = book.metadata;
  const heading = `# ${title ?? entryName(entry)}`;
  return author === undefined ? heading : `${heading}\n\n${author}`;
}
