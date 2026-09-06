import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, writeModel, type Model } from "@/book/model";
import { countWords } from "@/book/words";
import { report, setField, type Counting } from "@/ui/report";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

async function model(): Promise<Model> {
  return readModel(await readText(vault, BOOK));
}

/** The fixture vault, every note counted. */
async function counting(): Promise<Counting> {
  const paths = (await vault.list("/")).files.filter((at) => at.endsWith(".md"));
  const counted = new Map<string, number>();
  for (const at of paths) counted.set(at, countWords(await readText(vault, at)));
  return { links: pathLinks(paths), words: (at) => counted.get(at) };
}

test("word counts come from the notes, and an entry with no note has none", async () => {
  const held = { path: BOOK, name: "PP draft", model: await model() };

  const made = report(held, await counting());

  assert.equal(made.name, "Pride and Prejudice");
  assert.equal(made.format, 1);
  // The reading order, in the order the note lists it, with each note's
  // own count beside it. A generated section and a missing note have
  // no words to count.
  assert.deepEqual(
    made.lines.map((line) => [line.at, line.name, line.words]),
    [
      [0, "Title page", undefined],
      [1, "Copyright", 16],
      [2, "A note on the text", 21],
      [3, "Contents", undefined],
      [4, "Volume the First", 3],
      [5, "Chapter Twelve", 186],
      [6, "Chapter Four", undefined],
      [7, "Acknowledgements", 22],
    ],
  );
  assert.equal(made.words, 16 + 21 + 3 + 186 + 22);
  // The two entries in the default role, the missing one included.
  assert.equal(made.chapters, 2);

  // A note not yet counted is drawn without a count, and the sum leaves
  // it out.
  const uncounted = report(held, { links: pathLinks([]), words: () => undefined });
  assert.deepEqual(
    uncounted.lines.map((line) => line.kind),
    Array.from({ length: 8 }, (_, at) => (at === 0 || at === 3 ? "generated" : "missing")),
  );
  assert.equal(uncounted.words, 0);
});

test("every property orca owns is a field, and an emptied one comes off the note", async () => {
  const held = await model();
  const vaulted = await counting();

  const before = report({ path: BOOK, name: "Pride and Prejudice", model: held }, vaulted);
  assert.deepEqual(
    before.fields.map((field) => [field.key, field.value]),
    [
      ["title", "Pride and Prejudice"],
      ["author", "Jane Austen"],
      ["language", "en-GB"],
      ["date", "1813-01-28"],
      ["publisher", "Whitehall Press"],
      ["series", "The Bennet Novels"],
      ["isbn", "978-0-000-00000-0"],
    ],
  );

  const edited = setField(setField(held, "publisher", "Whitehall Press, London"), "series", "");
  const after = report({ path: BOOK, name: "Pride and Prejudice", model: edited }, vaulted);
  assert.deepEqual(
    after.fields.map((field) => [field.key, field.value]),
    [
      ["title", "Pride and Prejudice"],
      ["author", "Jane Austen"],
      ["language", "en-GB"],
      ["date", "1813-01-28"],
      ["publisher", "Whitehall Press, London"],
      ["series", ""],
      ["isbn", "978-0-000-00000-0"],
    ],
  );
  assert.equal(Object.hasOwn(edited.book.metadata, "series"), false);
  assert.match(writeModel(edited), /\npublisher: Whitehall Press, London\n/);
  assert.doesNotMatch(writeModel(edited), /\nseries:/);
  // The edit is to the properties alone.
  assert.equal(edited.order, held.order);
  // A note with no title is named after itself.
  const untitled = report(
    { path: BOOK, name: "PP draft", model: setField(held, "title", "") },
    vaulted,
  );
  assert.equal(untitled.name, "PP draft");
  assert.equal(untitled.fields[0]?.value, "");
});

// What this tier does not cover: the page drawn from the report, the
// write on settle and the click that focuses the navigator, which the
// e2e suite covers.
