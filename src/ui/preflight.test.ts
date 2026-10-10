import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/testUtils/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel } from "@/book/model";
import { resolve, type Section } from "@/book/order";
import type { Design } from "@/style/design";
import { preflight, standing, type Checking } from "@/ui/preflight";

const NOTE = "---\norca-book: 1\ntitle: Pride and Prejudice\n---\n";

function design(): Design {
  return readModel(NOTE).book.design;
}

function book(changes: Partial<Checking>): Checking {
  return { design: design(), sections: [], unloaded: [], unread: [], warnings: [], ...changes };
}

/** The book note in the fixture vault. It lists a chapter that has no note. */
const BOOK = "Pride and Prejudice.md";

/** The sections of the fixture book, resolved against the fixture vault. */
async function fixtureSections(): Promise<Section[]> {
  const root = process.env["ORCA_ROOT"] ?? process.cwd();
  const vault = directoryVault(path.join(root, "fixture"));
  const model = readModel(await readText(vault, BOOK));
  const links = pathLinks((await vault.list("/")).files);
  return resolve(model.order, links, BOOK).sections;
}

test("a section with no note is listed by the name the book note gives it", () => {
  const sections: Section[] = [
    { kind: "generated", entry: { role: "title-page", heading: "Front matter" } },
    { kind: "missing", entry: { link: "Drafts/One", alias: "The First", role: "chapter", heading: "Body" } },
    { kind: "note", entry: { link: "Two", role: "chapter", heading: "Body" }, path: "Two.md" },
    { kind: "missing", entry: { link: "Three", role: "chapter", heading: "" } },
  ];

  const checked = preflight(book({ sections }));

  assert.deepEqual(
    checked.errors.map((each) => [each.kind, each.said, each.place, each.row]),
    [
      ["note", "Missing note: The First", "Body", 1],
      ["note", "Missing note: Three", "Book", 3],
    ],
  );
});

test("a missing note is an error, so the book does not pass and export stays off", () => {
  const sections: Section[] = [
    { kind: "missing", entry: { link: "One", role: "chapter", heading: "Body" } },
  ];

  const checked = preflight(book({ sections }));

  assert.equal(checked.fine, undefined);
  assert.equal(standing(checked.errors.length), "Fix 1 error to export");
});

test("the row of a missing note goes to its place in the reading order", () => {
  const sections: Section[] = [
    { kind: "note", entry: { link: "One", role: "chapter", heading: "Body" }, path: "One.md" },
    { kind: "missing", entry: { link: "Two", role: "chapter", heading: "Body" } },
  ];

  const [error] = preflight(book({ sections })).errors;

  assert.equal(error?.fix, "Show in navigator");
  assert.equal(error?.row, 1);
  assert.equal(error?.at, undefined);
});

test("the fixture book lists a chapter with no note, and preflight refuses it", async () => {
  const sections = await fixtureSections();

  const checked = preflight(book({ sections }));

  assert.deepEqual(
    checked.errors.map((each) => [each.said, each.place, each.row]),
    [["Missing note: Chapter Four", "Body", 6]],
  );
  assert.equal(checked.fine, undefined);
});

test("a face that registered no file refuses, and names where the font is used", () => {
  const set = design();
  set.body = { ...set.body, font: "Charter", fontVariant: "Italic" };
  const use = { font: "Charter", variant: "Italic" };

  const checked = preflight(book({ design: set, unloaded: [{ use, unread: false }] }));

  assert.equal(checked.errors.length, 1);
  assert.equal(checked.errors[0]?.said, "Missing font: Charter Italic");
  assert.equal(checked.errors[0]?.place, "Body text, headings 1–6");

  // A font only the heads or the folios are set in names them.
  const heads = design();
  heads.headers = { ...heads.headers, font: "Charter", folioFont: "Charter" };
  const plain = { font: "Charter", variant: undefined };
  assert.equal(
    preflight(book({ design: heads, unloaded: [{ use: plain, unread: false }] })).errors[0]?.place,
    "Headers, page numbers",
  );
  assert.equal(checked.errors[0]?.fix, "Change font…");
  assert.equal(checked.fine, undefined);
  assert.equal(standing(1), "Fix 1 error to export");
});

test("an image that brought no bytes refuses with its note and line, and carries the engine's warning as it came", () => {
  const warning = { message: "image `hunsford.png` was not registered", origin: "Part/Chapter Twenty-Two.md:3:1" };

  const checked = preflight(
    book({
      unread: [{ url: "hunsford.png", note: "Part/Chapter Twenty-Two.md", line: 2 }],
      warnings: [warning, { message: "elsewhere", origin: "Part/Chapter Twenty-Two.md:9:1" }],
    }),
  );

  assert.deepEqual(checked.errors, [
    {
      kind: "image",
      said: "Missing image: hunsford.png",
      place: "Chapter Twenty-Two, line 3",
      fix: "Go to line",
      engine: warning.message,
      at: { note: "Part/Chapter Twenty-Two.md", line: 2 },
      row: undefined,
    },
  ]);
  assert.equal(checked.fine, undefined);
  assert.equal(standing(2), "Fix 2 errors to export");
});

test("a clean book passes with no errors", () => {
  const checked = preflight(book({}));

  assert.deepEqual(checked.errors, []);
  assert.deepEqual(checked.warnings, []);
  assert.equal(checked.fine, "No errors");
});

test("each warning from the session is listed in the engine's words", () => {
  const warnings = [
    { message: "text overflows its box by 4.2pt", origin: "Part/Chapter One.md:12:1" },
    { message: "no font has the glyph U+2767", origin: null },
    { message: "unknown property `colour`", origin: "book.css:4:3" },
  ];

  const checked = preflight(book({ warnings }));

  assert.deepEqual(
    checked.warnings.map((each) => each.said),
    warnings.map((each) => each.message),
  );
});

test("warnings alone leave the book passing, and the line counts them", () => {
  const warnings = [
    { message: "text overflows its box by 4.2pt", origin: "Chapter One.md:12:1" },
    { message: "no font has the glyph U+2767", origin: null },
  ];

  const checked = preflight(book({ warnings }));

  assert.deepEqual(checked.errors, []);
  assert.equal(checked.fine, "No errors · 2 warnings");
  assert.equal(preflight(book({ warnings: warnings.slice(0, 1) })).fine, "No errors · 1 warning");

  // A warning against a sheet orca writes is not the author's, and is not counted.
  const own = { message: "orca's defect", origin: "design.css:1:1" };
  assert.equal(preflight(book({ warnings: [...warnings, own] })).fine, "No errors · 2 warnings");
});

test("a warning with an origin goes to its note and line, and one without goes to Issues", () => {
  const checked = preflight(
    book({
      warnings: [
        { message: "text overflows its box by 4.2pt", origin: "Part/Chapter One.md:12:5" },
        { message: "unknown property `colour`", origin: "book.css:4:3" },
        { message: "no font has the glyph U+2767", origin: null },
      ],
    }),
  );

  assert.deepEqual(checked.warnings, [
    {
      said: "text overflows its box by 4.2pt",
      place: "Chapter One, line 12",
      fix: "Go to line",
      at: { route: "note", place: { sheet: "Part/Chapter One.md", line: 12, column: 5 } },
    },
    {
      said: "unknown property `colour`",
      place: "The book's CSS, line 4",
      fix: "Go to line",
      at: { route: "css", place: { sheet: "book.css", line: 4, column: 3 } },
    },
    { said: "no font has the glyph U+2767", place: undefined, fix: "Open Issues", at: undefined },
  ]);
});

test("a warning an image error shows is not listed again", () => {
  const image = { message: "image `hunsford.png` was not registered", origin: "Chapter Twenty-Two.md:3:1" };
  const other = { message: "text overflows its box by 4.2pt", origin: "Chapter Twenty-Two.md:9:1" };

  const checked = preflight(
    book({
      unread: [{ url: "hunsford.png", note: "Chapter Twenty-Two.md", line: 2 }],
      warnings: [image, other],
    }),
  );

  assert.equal(checked.errors[0]?.engine, image.message);
  assert.deepEqual(
    checked.warnings.map((each) => each.said),
    [other.message],
  );
  // The errors still stand, so the book does not pass.
  assert.equal(checked.fine, undefined);
});

// What this tier does not cover: an error only the engine can see, such
// as an image format the writer cannot take, which waits on the engine
// reporting it. The dialog that draws these lines is read by the e2e
// suite, and so is the navigator a missing note's row opens.
