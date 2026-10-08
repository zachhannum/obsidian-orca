import assert from "node:assert/strict";
import { test } from "node:test";
import { readModel } from "@/book/model";
import type { Design } from "@/style/design";
import { preflight, standing, type Checking } from "@/ui/preflight";

const NOTE = "---\norca-book: 1\ntitle: Pride and Prejudice\n---\n";

function design(): Design {
  return readModel(NOTE).book.design;
}

function book(changes: Partial<Checking>): Checking {
  return { design: design(), unloaded: [], unread: [], warnings: [], ...changes };
}

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
// suite.
