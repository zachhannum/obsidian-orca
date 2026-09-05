/**
 * The book note's format: the key that makes a note a book, the
 * properties orca owns, and how a note at an older format is read.
 */

import { writeFrontmatter, type Properties, type Value } from "@/book/frontmatter";

/** Frontmatter key that makes a note a book. Its value is the format. */
export const BOOK_KEY = "orca-book";

/** The format orca writes. A note above it does not open. */
export const FORMAT = 1;

/** An error from `book`. Only `ui` turns one into something an author sees. */
export class BookError extends Error {
  override readonly name = "BookError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/** What names the book, as the author writes it in the properties. */
export interface BookMetadata {
  title?: string;
  author?: string;
  language?: string;
  date?: string;
  publisher?: string;
  series?: string;
  isbn?: string;
}

export interface Book {
  /** The format the note is written in, which is below `FORMAT` for a note orca has migrated. */
  format: number;
  metadata: BookMetadata;
  /** The author's own properties, which orca keeps and does not read. */
  own: Properties;
}

/**
 * How one property orca owns is read and written. A `tag` comes from a
 * closed set and is quoted, because unquoted `no` is boolean false. A
 * `length` includes its unit, so it stays a string rather than becoming
 * a bare number.
 */
export type Kind = "text" | "tag" | "length";

interface Field {
  key: keyof BookMetadata;
  kind: Kind;
}

/** The properties orca owns, in the order they are written. */
const FIELDS: readonly Field[] = [
  { key: "title", kind: "text" },
  { key: "author", kind: "text" },
  { key: "language", kind: "tag" },
  { key: "date", kind: "text" },
  { key: "publisher", kind: "text" },
  { key: "series", kind: "text" },
  { key: "isbn", kind: "text" },
];

/** Orca's own keys, in the order the format writes them. */
export const FIELD_KEYS: readonly (keyof BookMetadata)[] = FIELDS.map(
  (field) => field.key,
);

/** The keys written quoted whatever their value is. */
export const QUOTED: ReadonlySet<string> = new Set(
  FIELDS.filter((field) => field.kind === "tag").map((field) => field.key),
);

/** The unit a length is written in when the note has a bare number. */
const UNIT = "pt";

/** What a note at one format needs to become the next one. */
const STEPS: Readonly<Record<number, (properties: Properties) => Properties>> = {};

/** The format a book note is written in, or nothing when the note is not a book. */
export function bookFormat(properties: Properties): number | undefined {
  const value = properties[BOOK_KEY];
  if (value === undefined || value === null) return undefined;
  const format = Number(value);
  return Number.isFinite(format) ? format : undefined;
}

/**
 * The book in a note. A note below `FORMAT` is migrated on the way
 * in and keeps the format it was written in, so nothing is written
 * back until the author causes a save. A note above `FORMAT` is a book
 * this orca cannot read, and the error names both formats.
 */
export function readBook(properties: Properties): Book {
  const format = bookFormat(properties);
  if (format === undefined) {
    throw new BookError(`the note has no \`${BOOK_KEY}\` property`);
  }
  if (format > FORMAT) {
    throw new BookError(
      `orca reads format ${FORMAT}, and this book is written in format ${format}`,
    );
  }

  const migrated = migrate(properties, format);
  const metadata: BookMetadata = {};
  const own: Properties = {};
  for (const [key, value] of Object.entries(migrated)) {
    if (key === BOOK_KEY) continue;
    const field = FIELDS.find((named) => named.key === key);
    if (field === undefined) own[key] = value;
    else if (value !== null) metadata[field.key] = readValue(value, field.kind);
  }
  return { format, metadata, own };
}

/**
 * The properties a book is written back as, at `FORMAT`. Orca's own
 * keys come first, in the format's order, and the author's follow as
 * they were read.
 */
export function writeBook(book: Book): Properties {
  const properties: Properties = { [BOOK_KEY]: FORMAT };
  for (const { key } of FIELDS) {
    const value = book.metadata[key];
    if (value !== undefined) properties[key] = value;
  }
  return { ...properties, ...book.own };
}

/**
 * The book, written into properties a note already has. Orca's own
 * keys are set at `FORMAT` and the ones the book no longer has are
 * removed; every other property is the author's and is left as it is. `ui` hands this the object Obsidian's frontmatter API parsed.
 */
export function applyBook(properties: Properties, book: Book): void {
  properties[BOOK_KEY] = FORMAT;
  for (const { key } of FIELDS) {
    const held = book.metadata[key];
    if (held === undefined) delete properties[key];
    else properties[key] = held;
  }
}

/** A book note as text, which is how a new one is created. */
export function writeNote(book: Book, body: string): string {
  return writeFrontmatter({ properties: writeBook(book), body }, QUOTED);
}

/**
 * The properties in this format, one step per format
 * between the note's and this one. Migration happens in memory, and the
 * note on disk is left as it is.
 */
function migrate(properties: Properties, from: number): Properties {
  let current = properties;
  for (let format = from; format < FORMAT; format += 1) {
    const step = STEPS[format];
    if (step === undefined) {
      throw new BookError(`orca reads format ${format} but cannot migrate it`);
    }
    current = step(current);
  }
  return current;
}

/**
 * One property, as the format has it. A parser gives back `false`
 * for `no` and a number for `1813`, and both are strings here; a
 * length that arrived bare is given the unit back.
 */
export function readValue(value: Value, kind: Kind): string {
  if (kind === "length" && typeof value === "number") return `${value}${UNIT}`;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value) || typeof value === "object") return "";
  return String(value);
}
