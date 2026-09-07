/**
 * The reading order, as the ops that cross to the engine, and the op
 * one later edit sends.
 *
 * The whole order crosses as one `book` op with `split: 0`, so each
 * source is exactly one section. There is no smaller op for a
 * reorder: order is read from where a source sits in the list, so
 * moving one sends the list again.
 *
 * An edit's op is decided here, because orca is the only side that
 * knows what the edit invalidated. Which stages the engine re-runs
 * from it is the engine's own business.
 */

import { styleOp, type Op, type Sheet, type Source } from "fleuron";
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

/** The book's reading order, as the ops that typeset it. */
export async function sendBook(
  book: Book,
  order: Order,
  links: Links,
  from: string,
  read: Read,
): Promise<Op[]> {
  return [
    { op: "dialect", dialect: "obsidian" },
    { op: "split", level: 0 },
    { op: "book", sources: await bookSources(book, order, links, from, read) },
    { op: "metadata", metadata: documentMetadata(book) },
  ];
}

/**
 * The book's sources in reading order, which is also what a reorder
 * sends again. A section with no note is dropped; the warning it
 * raised is `resolve`'s.
 */
export async function bookSources(
  book: Book,
  order: Order,
  links: Links,
  from: string,
  read: Read,
): Promise<Source[]> {
  const present = resolve(order, links, from).sections.filter(sendable);
  return Promise.all(
    present.map((section, at) => sourceOf(section, at, book, read)),
  );
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

/** A face a book is set in. */
export interface Face {
  /**
   * The face file's content hash. Two picks of the same file cross
   * once, whatever they were named.
   */
  key: string;
  bytes: Uint8Array;
}

/** One thing the author did, as much of it as deciding the ops takes. */
export type Edit =
  /** Typed in a chapter, so one source is replaced and the rest stand. */
  | { did: "typed"; name: string; text: string }
  /**
   * Moved a slider, or changed a margin. Both send the sheet, and the
   * engine reads off the declarations that moved whether the lines
   * break again.
   */
  | { did: "styled"; sheets: Sheet[] }
  /** Reordered chapters, so every source crosses in its new place. */
  | { did: "reordered"; sources: Source[] }
  /** Picked a new face, and the sheet that names it. */
  | { did: "faced"; face: Face; sheets: Sheet[] }
  /** Deleted a note, so the rest of the sources stand. */
  | { did: "deleted"; name: string };

/**
 * The session as a plan leaves it. A face is kept for the session's
 * life, so a pick that names one already registered plans no `font`
 * op at all.
 */
export interface Loaded {
  /** The sheets the engine is styling with, in cascade order. */
  sheets: readonly Sheet[];
  /** The faces registered on the session, by key. */
  faces: ReadonlySet<string>;
}

/** A session with nothing on it yet. */
export const LOADED_NOTHING: Loaded = { sheets: [], faces: new Set<string>() };

/** One edit, planned. */
export interface Planned {
  ops: Op[];
  /** The session the ops leave behind, which the next plan reads. */
  loaded: Loaded;
}

/**
 * Plans the ops one edit sends. The same edit against the same session
 * plans the same ops, so a plan can be compared rather than run.
 *
 * A reorder sends the sheets again unchanged. A positional selector
 * matches on where a source sits, so a sheet compiled against the
 * order before the move is stale even though its text is not.
 */
export function sendEdit(edit: Edit, loaded: Loaded): Planned {
  switch (edit.did) {
    case "typed":
      return {
        ops: [{ op: "edit", name: edit.name, text: edit.text }],
        loaded,
      };
    case "deleted":
      return { ops: [{ op: "remove", name: edit.name }], loaded };
    case "styled":
      return {
        ops: [styling(edit.sheets)],
        loaded: { ...loaded, sheets: edit.sheets },
      };
    case "reordered":
      return {
        ops: [{ op: "book", sources: edit.sources }, styling(loaded.sheets)],
        loaded,
      };
    case "faced":
      return faced(edit.face, edit.sheets, loaded);
  }
}

/** Registers the face unless the session already holds it, then styles. */
function faced(face: Face, sheets: Sheet[], loaded: Loaded): Planned {
  if (loaded.faces.has(face.key)) {
    return { ops: [styling(sheets)], loaded: { ...loaded, sheets } };
  }
  return {
    ops: [{ op: "font", bytes: face.bytes }, styling(sheets)],
    loaded: { sheets, faces: new Set([...loaded.faces, face.key]) },
  };
}

function styling(sheets: readonly Sheet[]): Op {
  return styleOp([...sheets]);
}
