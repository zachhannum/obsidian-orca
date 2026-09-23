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
    "Running heads, page numbers",
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
  assert.equal(checked.fine, "No errors");
});

// What this tier does not cover: an error only the engine can see, such
// as an image format the writer cannot take, which waits on the engine
// reporting it. The dialog that draws these lines is read by the e2e
// suite.
