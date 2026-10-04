/**
 * The book note's format: the key that makes a note a book, the
 * properties orca owns, and how a note at an older format is read.
 */

import {
  writeFrontmatter,
  type Properties,
  type Value,
} from "@/book/frontmatter";
import {
  DESIGN_KEYS,
  readDesign,
  writeDesign,
  type Design,
} from "@/style/design";

/** Frontmatter key that makes a note a book. Its value is the format. */
export const BOOK_KEY = "orca-book";

/** Frontmatter key that holds the fonts the book adds. Its value is a list of family names. */
export const FONTS_KEY = "fonts";

/** Frontmatter key that holds the book's identifier. */
export const IDENTIFIER_KEY = "identifier";

/**
 * Frontmatter key that holds the deepest heading level the navigator
 * lists for the book. Its value is a whole number, and 0 lists none.
 */
export const HEADINGS_KEY = "navigator-headings";

/** The deepest heading level Markdown writes. */
export const DEEPEST_LEVEL = 6;

/** The format orca writes. A note above it does not open. */
export const FORMAT = 1;

/** An error from `book`. Only `ui` turns one into something an author sees. */
export class BookError extends Error {
  override readonly name: string = "BookError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/** A book in a format above `FORMAT`, which a newer orca wrote. */
export class NewerBookError extends BookError {
  override readonly name = "NewerBookError";

  constructor() {
    super(
      "This book was made by a newer version of Orca than the one currently installed in this vault.",
    );
  }
}

/** The book's metadata, as the author writes it in the properties. */
export interface BookMetadata {
  title?: string;
  author?: string;
  language?: string;
  date?: string;
  publisher?: string;
  series?: string;
  isbn?: string;
  /** The image an EPUB shows as its cover, as a vault path or a wikilink. */
  cover?: string;
}

export interface Book {
  /** The format the note is written in, which is below `FORMAT` for a note orca has migrated. */
  format: number;
  metadata: BookMetadata;
  /**
   * The name an EPUB is told apart by, as a `urn:uuid:` value. A book
   * store reads a new identifier as a new book, so one that is written
   * is never written again.
   */
  identifier?: string;
  /**
   * The fonts the book adds, in the order they were added. No design
   * key names one, and each registers a face, so the author's CSS can
   * name it. A name is listed once, however it is capitalized.
   */
  fonts: string[];
  /**
   * The deepest heading level the navigator lists for this book, from 0
   * for none to `DEEPEST_LEVEL`. A book without it follows the setting.
   */
  headings?: number | undefined;
  /** The design, which is this note's own frontmatter. */
  design: Design;
  /** The author's own properties, which orca keeps and does not read. */
  own: Properties;
}

/**
 * The kind of a property orca owns, which sets how it is read and
 * written. A `tag` comes from a closed set and is quoted, because
 * unquoted `no` is boolean false. A `length` includes its unit, so it
 * stays a string rather than becoming a bare number.
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
  { key: "cover", kind: "text" },
];

/** Orca's own keys, in the order the format writes them. */
export const FIELD_KEYS: readonly (keyof BookMetadata)[] = FIELDS.map(
  (field) => field.key,
);

/** The keys written quoted whatever their value is. */
export const QUOTED: ReadonlySet<string> = new Set(
  FIELDS.filter((field) => field.kind === "tag").map((field) => field.key),
);

/** The keys orca owns that are neither metadata nor design. */
const OWNED: ReadonlySet<string> = new Set([
  BOOK_KEY,
  FONTS_KEY,
  IDENTIFIER_KEY,
  HEADINGS_KEY,
]);

/** The unit a length is written in when the note has a bare number. */
const UNIT = "pt";

/** The migration from each format to the next, keyed by the format it starts from. */
const STEPS: Readonly<Record<number, (properties: Properties) => Properties>> =
  {};

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
 * this orca cannot read.
 */
export function readBook(properties: Properties): Book {
  const format = bookFormat(properties);
  if (format === undefined) {
    throw new BookError("This note is not an Orca book.");
  }
  if (format > FORMAT) {
    throw new NewerBookError();
  }

  const migrated = migrate(properties, format);
  const metadata: BookMetadata = {};
  const own: Properties = {};
  for (const [key, value] of Object.entries(migrated)) {
    if (OWNED.has(key) || DESIGN_KEYS.includes(key)) continue;
    const field = FIELDS.find((named) => named.key === key);
    if (field === undefined) own[key] = value;
    else if (value !== null) metadata[field.key] = readValue(value, field.kind);
  }
  const fonts = readFonts(migrated[FONTS_KEY]);
  const book: Book = { format, metadata, fonts, design: readDesign(migrated), own };
  const headings = readHeadings(migrated[HEADINGS_KEY]);
  if (headings !== undefined) book.headings = headings;
  const identifier = heldIdentifier(migrated);
  if (identifier !== undefined) book.identifier = identifier;
  return book;
}

/**
 * The book with the identifier it is written with. The one the note
 * already has comes first, so a model read before the note got one
 * cannot replace it. A book with none anywhere gets a new one.
 */
export function identified(
  book: Book,
  properties: Properties,
  mint: () => string = newIdentifier,
): Book {
  const identifier = heldIdentifier(properties) ?? book.identifier ?? mint();
  return { ...book, identifier };
}

/** A new identifier, which no other book has. */
export function newIdentifier(): string {
  return `urn:uuid:${crypto.randomUUID()}`;
}

/** The identifier the properties hold. An empty one is none. */
function heldIdentifier(properties: Properties): string | undefined {
  const held = properties[IDENTIFIER_KEY];
  return typeof held === "string" && held.trim() !== "" ? held : undefined;
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
  if (book.identifier !== undefined) properties[IDENTIFIER_KEY] = book.identifier;
  if (book.fonts.length > 0) properties[FONTS_KEY] = [...book.fonts];
  if (book.headings !== undefined) properties[HEADINGS_KEY] = book.headings;
  return { ...properties, ...writeDesign(book.design), ...book.own };
}

/**
 * The book, written into properties a note already has. Orca's own
 * keys are set at `FORMAT` and the ones the book no longer has are
 * removed; every other property is the author's and is left as it is.
 * An identifier is set and never removed. `ui` hands this the object
 * Obsidian's frontmatter API parsed.
 */
export function applyBook(properties: Properties, book: Book): void {
  properties[BOOK_KEY] = FORMAT;
  for (const { key } of FIELDS) {
    const value = book.metadata[key];
    if (value === undefined) delete properties[key];
    else properties[key] = value;
  }
  if (book.identifier !== undefined) properties[IDENTIFIER_KEY] = book.identifier;
  if (book.fonts.length > 0) properties[FONTS_KEY] = [...book.fonts];
  else delete properties[FONTS_KEY];
  if (book.headings === undefined) delete properties[HEADINGS_KEY];
  else properties[HEADINGS_KEY] = book.headings;
  const design = writeDesign(book.design);
  for (const key of DESIGN_KEYS) {
    const value = design[key];
    if (value === undefined) delete properties[key];
    else properties[key] = value;
  }
}

/** A book note as text, which is how a new one is created. */
export function writeNote(book: Book, body: string): string {
  return writeFrontmatter({ properties: writeBook(book), body }, QUOTED);
}

/**
 * The fonts a note adds. One name written bare reads as a list of one,
 * and a name the list repeats is kept once, however it is capitalized.
 */
function readFonts(value: Value | undefined): string[] {
  const listed = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const fonts: string[] = [];
  for (const each of listed) {
    if (typeof each !== "string") continue;
    const name = each.trim();
    const key = name.toLowerCase();
    if (name === "" || seen.has(key)) continue;
    seen.add(key);
    fonts.push(name);
  }
  return fonts;
}

/**
 * The heading level a note sets. A number outside the levels reads as
 * the nearest one, and a value that is no number reads as none set.
 */
function readHeadings(value: Value | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.floor(value), 0), DEEPEST_LEVEL);
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
      throw new BookError(
        "This book was made by an older version of Orca and cannot be opened.",
      );
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
