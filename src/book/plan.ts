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
 *
 * The engine opens no file, so an embed resolves through the vault
 * here, and its bytes cross ahead of the sources that name it.
 */

import { styleOp, type Op, type Sheet, type Source } from "fleuron";
import type { Hashed, Sent } from "@/assets/registry";
import { imagesIn } from "@/book/images";
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
import type { Role } from "@/book/roles";

/** Reads a section's note, by its vault path. `ui` implements this over the vault. */
export interface Read {
  (path: string): Promise<string>;
}

/**
 * Reads the file an embed resolved to and keys its bytes. `ui`
 * implements this over the registry.
 */
export interface Take {
  (path: string): Promise<Hashed>;
}

/** An image the book embeds, as the registry read and keyed it. */
export interface Image extends Hashed {
  /** The url the manuscript names it by, which the engine keys it on. */
  url: string;
}

/** A book, as the ops that typeset it and the images those ops registered. */
export interface Sending {
  ops: Op[];
  /** The images the ops put on the wire, for the registry to record. */
  images: Image[];
}

/** The prefix a generated section's name carries, so it is never read as a note's path. */
export const GENERATED_ORIGIN = "orca-generated";

/** Whether a source the engine named is generated matter rather than a note. */
export function isGenerated(name: string): boolean {
  return name.startsWith(`${GENERATED_ORIGIN}:`);
}

/** A resolved section with something to send: a note or a generated one. */
type Sendable = Exclude<Section, { kind: "missing" }>;

/**
 * The book's reading order, as the ops that typeset it, with every
 * image its sources embed registered ahead of them.
 */
export async function sendBook(
  book: Book,
  order: Order,
  links: Links,
  from: string,
  read: Read,
  take: Take,
): Promise<Sending> {
  const sources = await bookSources(book, order, links, from, read);
  const images = await bookImages(sources, links, take);
  return {
    ops: [
      { op: "dialect", dialect: "obsidian" },
      { op: "split", level: 0 },
      ...images.map((image): Op => ({
        op: "image",
        url: image.url,
        bytes: image.bytes,
      })),
      { op: "book", sources },
      { op: "metadata", metadata: documentMetadata(book) },
    ],
    images,
  };
}

/**
 * The cuts of one family, as the ops that register them. A book set on
 * a new engine sends them again. A face is registered for one session,
 * and a session that stopped took its faces with it.
 */
export function sendFaces(faces: readonly Face[]): Op[] {
  return faces.map((face) => ({ op: "font", bytes: face.bytes }));
}

/**
 * Every image the sources embed, resolved through the vault, each url
 * once. An embed with no file behind it sends nothing, and the engine
 * warns about the url it was given no bytes for.
 *
 * An embed that resolves to a note is a transclusion, which orca does
 * not set.
 */
export async function bookImages(
  sources: readonly Source[],
  links: Links,
  take: Take,
): Promise<Image[]> {
  const wanted = new Map<string, string>();
  for (const source of sources) {
    if (isGenerated(source.name)) continue;
    for (const embed of imagesIn(source.text)) {
      if (wanted.has(embed.url)) continue;
      const path = links.find(embed.link, source.name);
      if (path === undefined || path.endsWith(".md")) continue;
      wanted.set(embed.url, path);
    }
  }
  const read = await Promise.all(
    [...wanted].map(async ([url, path]) => {
      // A file that will not read crosses no bytes, the same as one
      // the vault never had.
      const bytes = await take(path).catch(() => undefined);
      return bytes === undefined ? undefined : { url, ...bytes };
    }),
  );
  return read.filter((image) => image !== undefined);
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

/**
 * The role of each section that crosses, in the order the engine
 * counts them. The generated layer reaches a role by counting. It
 * counts the sections that are sent rather than the ones the note
 * lists.
 */
export function sentRoles(sections: readonly Section[]): Role[] {
  return sections.filter(sendable).map((section) => section.entry.role);
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

/** A face a book is set in, as the registry read and keyed it. */
export type Face = Hashed;

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
  /**
   * Reordered chapters, so every source crosses in its new place. The
   * sheets cross again with them, because the generated layer reaches
   * a role by counting and the count moved.
   */
  | { did: "reordered"; sources: Source[]; sheets: Sheet[] }
  /** Picked a new family, and the cuts it is made of. */
  | { did: "fonted"; faces: readonly Face[]; sheets: Sheet[] }
  /** Deleted a note, so the rest of the sources stand. */
  | { did: "deleted"; name: string }
  /**
   * Embedded an image a chapter did not name before. The engine keys
   * an image on the url rather than on its bytes, so a file already
   * registered under another url crosses again.
   */
  | { did: "embedded"; images: readonly Image[] };

/** The session as a plan leaves it. */
export interface Loaded {
  /** The sheets the engine is styling with, in cascade order. */
  sheets: readonly Sheet[];
}

/** A session with nothing on it yet. */
export const LOADED_NOTHING: Loaded = { sheets: [] };

/** One edit, planned. */
export interface Planned {
  ops: Op[];
  /** The session the ops leave behind, which the next plan reads. */
  loaded: Loaded;
  /** The asset keys these ops put on the wire, for the registry to record. */
  crossed: readonly string[];
}

/**
 * Plans the ops one edit sends. `assets` says what has already
 * crossed, and no plan writes to it: the same edit against the same
 * session plans the same ops, so a plan can be compared rather than
 * run. What the ops put on the wire comes back as
 * {@link Planned.crossed}, for the caller that sends them to record.
 */
export function sendEdit(edit: Edit, loaded: Loaded, assets: Sent): Planned {
  switch (edit.did) {
    case "typed":
      return {
        ops: [{ op: "edit", name: edit.name, text: edit.text }],
        loaded,
        crossed: [],
      };
    case "deleted":
      return {
        ops: [{ op: "remove", name: edit.name }],
        loaded,
        crossed: [],
      };
    case "styled":
      return {
        ops: [styling(edit.sheets)],
        loaded: { ...loaded, sheets: edit.sheets },
        crossed: [],
      };
    case "reordered":
      return {
        ops: [{ op: "book", sources: edit.sources }, styling(edit.sheets)],
        loaded: { ...loaded, sheets: edit.sheets },
        crossed: [],
      };
    case "embedded":
      return {
        ops: edit.images.map((image) => ({
          op: "image",
          url: image.url,
          bytes: image.bytes,
        })),
        loaded,
        crossed: [],
      };
    case "fonted":
      return faced(edit.faces, edit.sheets, loaded, assets);
  }
}

/**
 * Registers the cuts not already in the registry, in `faces` order,
 * then styles. A family whose cuts have all crossed sends the style
 * op alone.
 */
function faced(
  faces: readonly Face[],
  sheets: Sheet[],
  loaded: Loaded,
  assets: Sent,
): Planned {
  const crossing = faces.filter((face) => !assets.sent(face.key));
  return {
    ops: [
      ...crossing.map((face): Op => ({ op: "font", bytes: face.bytes })),
      styling(sheets),
    ],
    loaded: { ...loaded, sheets },
    crossed: crossing.map((face) => face.key),
  };
}

function styling(sheets: readonly Sheet[]): Op {
  return styleOp([...sheets]);
}
