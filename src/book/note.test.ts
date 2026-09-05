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
} from "@/book/note";

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
    { format: FORMAT, metadata: { language: "no" }, own: {} },
    "\n",
  );

  assert.match(written, /^---\norca-book: 1\nlanguage: "no"\n---\n$/);
  assert.equal(readBook(readFrontmatter(written).properties).metadata.language, "no");
});

test("orca's own properties are set on the note, and the author's are left as they are", async () => {
  const { properties } = await note();
  // The object Obsidian's frontmatter API hands over is the note's own
  // properties, orca's among them.
  const held = structuredClone(properties);
  const book = readBook(properties);
  book.metadata.title = "First Impressions";
  delete book.metadata.series;

  applyBook(held, book);

  assert.equal(held[BOOK_KEY], FORMAT);
  assert.equal(held["title"], "First Impressions");
  assert.equal(Object.hasOwn(held, "series"), false);
  // A property orca does not own survives the round trip whole, in the
  // place the author put it.
  assert.deepEqual(held["tags"], ["novel"]);
  assert.equal(held["status"], "drafting");
  assert.deepEqual(
    Object.keys(held).filter(
      (key) => key !== BOOK_KEY && !(FIELD_KEYS as readonly string[]).includes(key),
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

// What this tier does not cover: the view the note opens in and the way
// back to markdown, which the e2e job drives, and the design properties,
// which are the settings schema's to name.
