import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { readFrontmatter, type Properties } from "@/book/frontmatter";
import {
  BOOK_KEY,
  BookError,
  FIELD_KEYS,
  FORMAT,
  applyBook,
  bookFormat,
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
    { format: FORMAT, metadata: { language: "no" }, design: emptyDesign(), own: {} },
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

test("a book from a newer orca does not open, and the error names both formats", async () => {
  const { properties } = await note();

  assert.throws(
    () => readBook({ ...properties, [BOOK_KEY]: FORMAT + 1 }),
    (error: unknown) =>
      error instanceof BookError &&
      error.message.includes(`format ${FORMAT}`) &&
      error.message.includes(`format ${FORMAT + 1}`),
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

// What this tier does not cover: the view the note opens in and the way
// back to markdown, which the e2e job drives.
