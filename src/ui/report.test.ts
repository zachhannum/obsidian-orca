import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import type { Page } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, writeModel, type Model } from "@/book/model";
import { countWords } from "@/book/words";
import { foliate, report, setField, type Counting } from "@/ui/report";

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

test("page ranges come from a run's own pages, and an entry it has not reached has none", async () => {
  const held = { path: BOOK, name: "PP draft", model: await model() };

  // The 7 present sections' ids, in reading order: the missing
  // "Chapter Four" got none, and the run has not reached
  // "Acknowledgements" yet.
  const pages: Page[] = [
    { number: 1, side: "recto", width: 1, height: 1, sections: [1], items: [] },
    { number: 2, side: "verso", width: 1, height: 1, sections: [50], items: [] },
    // A section ending mid-page is followed there by the next one opening.
    { number: 3, side: "recto", width: 1, height: 1, sections: [80, 81], items: [] },
    { number: 4, side: "verso", width: 1, height: 1, sections: [82], items: [] },
    { number: 5, side: "recto", width: 1, height: 1, sections: [83], items: [] },
    { number: 6, side: "verso", width: 1, height: 1, sections: [83], items: [] },
  ];

  const made = report(held, await counting(), pages);

  assert.deepEqual(
    made.lines.map((line) => [line.name, line.pages]),
    [
      ["Title page", { first: 1, last: 1 }],
      ["Copyright", { first: 2, last: 2 }],
      ["A note on the text", { first: 3, last: 3 }],
      ["Contents", { first: 3, last: 3 }],
      ["Volume the First", { first: 4, last: 4 }],
      ["Chapter Twelve", { first: 5, last: 6 }],
      ["Chapter Four", undefined],
      ["Acknowledgements", undefined],
    ],
  );

  // No run at all names no range, generated sections included.
  const before = report(held, await counting());
  assert.ok(before.lines.every((line) => line.pages === undefined));
});

test("a folio range is a single number for one page, and a span for more", () => {
  assert.equal(foliate({ first: 5, last: 5 }), "5");
  assert.equal(foliate({ first: 121, last: 134 }), "121–134");
});

// What this tier does not cover: the page drawn from the report, the
// write on settle and the click that focuses the navigator, which the
// e2e suite covers.
