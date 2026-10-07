import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/testUtils/directory";
import { readText } from "@/assets/vault";
import { readFrontmatter, type Properties, type Value } from "@/book/frontmatter";
import {
  BOOK_KEY,
  DEEPEST_LEVEL,
  FIELD_KEYS,
  FONTS_KEY,
  FORMAT,
  HEADINGS_KEY,
  IDENTIFIER_KEY,
  NewerBookError,
  applyBook,
  bookFormat,
  identified,
  readBook,
  readValue,
  writeBook,
  writeNote,
  type Book,
} from "@/book/note";
import { DESIGN_KEYS, emptyDesign, readDesign } from "@/style/design";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

async function note(): Promise<{ properties: Properties; body: string }> {
  return readFrontmatter(await readText(vault, BOOK));
}

test("the key makes the note a book, and its value is the format", async () => {
  const { properties } = await note();

  assert.equal(bookFormat(properties), FORMAT);
  assert.equal(bookFormat({ title: "Chapter Twelve" }), undefined);

  const book = readBook(properties);
  assert.equal(book.format, FORMAT);
  assert.deepEqual(book.metadata, {
    title: "Pride and Prejudice",
    author: "Jane Austen",
    language: "en-GB",
    date: "1813-01-28",
    publisher: "Whitehall Press",
    series: "The Bennet Novels",
    isbn: "978-0-000-00000-0",
  });
});

test("an enum is quoted on write and coerced on read, and a length keeps its unit", () => {
  // `language: no` is Norwegian, and YAML reads it as boolean false.
  assert.equal(readValue(false, "tag"), "no");
  assert.equal(readValue(true, "tag"), "yes");
  assert.equal(readValue(10.5, "length"), "10.5pt");
  assert.equal(readValue("10.5pt", "length"), "10.5pt");
  assert.equal(readValue(1813, "text"), "1813");

  const written = writeNote(
    {
      format: FORMAT,
      metadata: { language: "no" },
      fonts: [],
      design: emptyDesign(),
      own: {},
    },
    "\n",
  );

  assert.match(written, /^---\norca-book: 1\nlanguage: "no"\n---\n$/);
  assert.equal(readBook(readFrontmatter(written).properties).metadata.language, "no");
});

test("orca's own properties are set on the note, and the author's are left as they are", async () => {
  const { properties } = await note();
  // The object Obsidian's frontmatter API hands over is the note's own
  // properties, orca's among them.
  const existing = structuredClone(properties);
  const book = readBook(properties);
  book.metadata.title = "First Impressions";
  delete book.metadata.series;

  applyBook(existing, book);

  assert.equal(existing[BOOK_KEY], FORMAT);
  assert.equal(existing["title"], "First Impressions");
  assert.equal(Object.hasOwn(existing, "series"), false);
  // A property orca does not own survives the round trip whole, in the
  // place the author put it.
  assert.deepEqual(existing["tags"], ["novel"]);
  assert.equal(existing["status"], "drafting");
  assert.deepEqual(
    Object.keys(existing).filter(
      (key) =>
        key !== BOOK_KEY &&
        !(FIELD_KEYS as readonly string[]).includes(key) &&
        !DESIGN_KEYS.includes(key),
    ),
    ["tags", "status"],
  );
});

test("a book note parsed and written back is byte-identical", async () => {
  const text = await readText(vault, BOOK);
  const { properties, body } = readFrontmatter(text);

  assert.equal(writeNote(readBook(properties), body), text);
});

test("a note at or below this format migrates in memory, and on disk waits for a save", async () => {
  const { properties } = await note();
  const before = structuredClone(properties);

  const book = readBook(properties);

  // Reading a book touches nothing: the new shape goes out with the
  // next save the author causes.
  assert.deepEqual(properties, before);
  assert.equal(writeBook(book)[BOOK_KEY], FORMAT);
  // Every format below this one has a step to the next, so a new
  // format cannot land without its migration.
  for (let format = 1; format < FORMAT; format += 1) {
    assert.doesNotThrow(() => readBook({ ...properties, [BOOK_KEY]: format }));
  }
});

test("a book from a newer orca does not open, and the error says a newer version made it", async () => {
  const { properties } = await note();

  assert.throws(
    () => readBook({ ...properties, [BOOK_KEY]: FORMAT + 1 }),
    (error: unknown) =>
      error instanceof NewerBookError &&
      error.message ===
        "This book was made by a newer version of Orca than the one currently installed in this vault.",
  );
});

test("the book's own frontmatter is the design, one key per line", () => {
  const design = readDesign({
    trim: "5.5in 8.5in",
    "body-font": "Alegreya",
    "body-line-spacing": "14pt",
    "body-hyphens": true,
    "body-orphans": 2,
  });
  const book: Book = {
    format: FORMAT,
    metadata: { title: "Pride and Prejudice" },
    fonts: [],
    design,
    own: {},
  };

  const text = writeNote(book, "\n");
  const read = readBook(readFrontmatter(text).properties);

  assert.deepEqual(read.design, design);
  assert.equal(
    text,
    [
      "---",
      "orca-book: 1",
      "title: Pride and Prejudice",
      "trim: 5.5in 8.5in",
      "body-font: Alegreya",
      "body-line-spacing: 14pt",
      "body-hyphens: true",
      "body-orphans: 2",
      "---",
      "",
    ].join("\n"),
  );
});

test("a design key the book no longer sets is taken off the note", () => {
  const properties = {
    [BOOK_KEY]: FORMAT,
    "body-line-spacing": "15pt",
    "body-orphans": 3,
  };
  const book = readBook(properties);

  applyBook(properties, {
    ...book,
    design: readDesign({ "body-line-spacing": "15pt" }),
  });

  assert.deepEqual(properties, {
    [BOOK_KEY]: FORMAT,
    "body-line-spacing": "15pt",
  });
  // A design key is orca's own, so it is not kept a second time as the
  // author's.
  assert.deepEqual(book.own, {});
});

test("the note holds the fonts the book adds", () => {
  const properties = { [BOOK_KEY]: FORMAT, [FONTS_KEY]: ["Junicode", " junicode ", "Alegreya"] };
  const book = readBook(properties);

  // A name the list repeats is kept once, and the author's own keys do
  // not pick the list up.
  assert.deepEqual(book.fonts, ["Junicode", "Alegreya"]);
  assert.deepEqual(book.own, {});

  const text = writeNote({ ...book, fonts: ["Junicode"] }, "\n");
  assert.match(text, /^---\norca-book: 1\nfonts:\n {2}- Junicode\n---\n$/);
  assert.deepEqual(readBook(readFrontmatter(text).properties).fonts, ["Junicode"]);

  applyBook(properties, { ...book, fonts: [] });
  assert.deepEqual(properties, { [BOOK_KEY]: FORMAT });
});

test("a note that adds fonts is written back byte for byte", () => {
  const text = `---\norca-book: 1\ntitle: Emma\nfonts:\n  - Junicode\n  - Alegreya\nbody-size: 11pt\nstatus: drafting\n---\n\n# Body\n`;
  const { properties, body } = readFrontmatter(text);

  assert.equal(writeNote(readBook(properties), body), text);
});

test("a book note with no identifier gets one on its first write, and every write after keeps it", async () => {
  const { properties: fixture, body } = await note();
  const authors: Properties[] = [
    fixture,
    { [BOOK_KEY]: FORMAT },
    { [BOOK_KEY]: FORMAT, title: "Emma", cover: "[[cover.png]]", status: "drafting" },
    { [BOOK_KEY]: FORMAT, [IDENTIFIER_KEY]: null },
    { [BOOK_KEY]: FORMAT, [IDENTIFIER_KEY]: "" },
  ];

  for (const properties of authors) {
    const read = readBook(properties);
    assert.equal(read.identifier, undefined);

    // The first write: the view applies the book to the note's own properties.
    const first = identified(read, properties);
    assert.match(
      first.identifier ?? "",
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const disk = structuredClone(properties);
    applyBook(disk, first);
    assert.equal(disk[IDENTIFIER_KEY], first.identifier);

    // A model read before the note had one writes the note's, not a new one.
    const never = (): string => assert.fail("a second identifier was made");
    const stale = identified(read, disk, never);
    assert.equal(stale.identifier, first.identifier);
    const again = structuredClone(disk);
    applyBook(again, { ...read, metadata: { ...read.metadata, title: "Another" } });
    assert.equal(again[IDENTIFIER_KEY], first.identifier);

    // Read and written back, it is the same note and the same identifier.
    const text = writeNote(first, body);
    const back = readBook(readFrontmatter(text).properties);
    assert.equal(back.identifier, first.identifier);
    assert.equal(identified(back, {}, never).identifier, first.identifier);
    assert.equal(writeNote(back, body), text);
  }
});

test("two books get two identifiers", () => {
  const book = readBook({ [BOOK_KEY]: FORMAT });

  assert.notEqual(identified(book, {}).identifier, identified(book, {}).identifier);
});

test("the note holds the heading level the navigator lists for the book", () => {
  const properties = { [BOOK_KEY]: FORMAT, [HEADINGS_KEY]: 2 };
  const book = readBook(properties);

  assert.equal(book.headings, 2);
  assert.deepEqual(book.own, {});

  const text = writeNote({ ...book, headings: 0 }, "\n");
  assert.match(text, /^---\norca-book: 1\nnavigator-headings: 0\n---\n$/);
  assert.equal(readBook(readFrontmatter(text).properties).headings, 0);

  // A note without the key follows the setting.
  assert.equal(readBook({ [BOOK_KEY]: FORMAT }).headings, undefined);
});

test("a note that sets its heading level is written back byte for byte", () => {
  for (let level = 0; level <= DEEPEST_LEVEL; level += 1) {
    const text = `---\norca-book: 1\ntitle: Emma\nfonts:\n  - Junicode\nnavigator-headings: ${level}\nbody-size: 11pt\nstatus: drafting\n---\n\n# Body\n`;
    const { properties, body } = readFrontmatter(text);

    assert.equal(writeNote(readBook(properties), body), text);
  }
});

test("a heading level the note cannot mean reads as the default", () => {
  const read = (value: Value): number | undefined =>
    readBook({ [BOOK_KEY]: FORMAT, [HEADINGS_KEY]: value }).headings;

  for (const value of ["3", "deep", true, false, null, [2], Number.NaN]) {
    assert.equal(read(value), undefined);
  }
  assert.equal(read(9), DEEPEST_LEVEL);
  assert.equal(read(-1), 0);
  assert.equal(read(2.5), 2);
});

test("a book that follows the default has no heading key on the note", () => {
  const properties = { [BOOK_KEY]: FORMAT, [HEADINGS_KEY]: 3, status: "drafting" };
  const { headings, ...book } = readBook(properties);
  assert.equal(headings, 3);

  applyBook(properties, book);
  assert.deepEqual(properties, { [BOOK_KEY]: FORMAT, status: "drafting" });

  applyBook(properties, { ...book, headings: 4 });
  assert.deepEqual(properties, {
    [BOOK_KEY]: FORMAT,
    status: "drafting",
    [HEADINGS_KEY]: 4,
  });
});

// What this tier does not cover: the view the note opens in and the way
// back to markdown, which the e2e job drives.
