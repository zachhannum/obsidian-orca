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
  return { design: design(), unloaded: [], unread: [], images: 0, warnings: [], ...changes };
}

test("a face that registered no file refuses, and names what it was chosen for", () => {
  const set = design();
  set.body = { ...set.body, font: "Charter", fontVariant: "Italic" };
  const use = { font: "Charter", variant: "Italic" };

  const checked = preflight(book({ design: set, unloaded: [{ use, unread: false }], images: 6 }));

  assert.equal(checked.errors.length, 1);
  assert.equal(checked.errors[0]?.said, "Charter Italic has no file the PDF could embed.");
  assert.equal(checked.errors[0]?.place, "chosen for the body text and level 1, 2, 3, 4, 5 and 6 headings");
  assert.equal(checked.errors[0]?.fix, "pick another face");
  // Every heading takes the body's face, so no other face is left to embed.
  assert.equal(checked.fine, "Every image resolves.");
  assert.equal(standing(1), "One error stands. Export will not write while it does.");
});

test("an image that brought no bytes refuses with its note and line, and carries the engine's warning as it came", () => {
  const warning = { message: "image `hunsford.png` was not registered", origin: "Part/Chapter Twenty-Two.md:3:1" };

  const checked = preflight(
    book({
      unread: [{ url: "hunsford.png", note: "Part/Chapter Twenty-Two.md", line: 2 }],
      images: 6,
      warnings: [warning, { message: "elsewhere", origin: "Part/Chapter Twenty-Two.md:9:1" }],
    }),
  );

  assert.deepEqual(checked.errors, [
    {
      kind: "image",
      said: "The vault has no hunsford.png.",
      place: "embedded in Chapter Twenty-Two, line 3",
      fix: "locate it",
      engine: warning.message,
      at: { note: "Part/Chapter Twenty-Two.md", line: 2 },
    },
  ]);
  assert.equal(checked.fine, "Every face embeds. The other six images resolve.");
  assert.equal(standing(2), "Two errors stand. Export will not write while they do.");
});

test("a clean book passes with the summary line", () => {
  const checked = preflight(book({ images: 1 }));

  assert.deepEqual(checked.errors, []);
  assert.equal(checked.fine, "Every face embeds. Every image resolves.");
});

// What this tier does not cover: an error only the engine can see, such
// as an image format the writer cannot take, which waits on the engine
// reporting it. The dialog that draws these lines is read by the e2e
// suite.
