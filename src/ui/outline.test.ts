import assert from "node:assert/strict";
import { test } from "node:test";
import { headingOn, markOf, outline, walk, type Cached } from "@/ui/outline";
import type { Row } from "@/ui/shelf";

/** The cache Obsidian holds for the fixture's `Chapter Fifteen.md`. */
const FIFTEEN: Cached[] = [
  { heading: "Chapter Fifteen", level: 1, position: { start: { line: 6 } } },
  { heading: "The Parsonage", level: 1, position: { start: { line: 13 } } },
  { heading: "The Entail {.plain #entail}", level: 2, position: { start: { line: 22 } } },
  {
    heading: "A Morning Call\nLongbourn, in the Spring",
    level: 2,
    position: { start: { line: 31 } },
  },
];

function entry(at: number, cached?: Cached[]): Row {
  const made: Row = { at, name: "Chapter Fifteen", kind: "note", role: "chapter", named: false };
  if (cached !== undefined) made.headings = outline(cached, made.name);
  return made;
}

test("an entry's headings are listed under it as a tree, and a folded entry marks only itself", () => {
  // The heading that repeats the entry's name is the entry's own row.
  assert.deepEqual(outline(FIFTEEN, "Chapter Fifteen"), [
    { line: 13, words: "The Parsonage", depth: 0 },
    { line: 22, words: "The Entail", depth: 1 },
    { line: 31, words: "A Morning Call Longbourn, in the Spring", depth: 1 },
  ]);
  // A note that opens on other words keeps its first heading.
  assert.equal(outline(FIFTEEN, "Fifteen")[0]?.words, "Chapter Fifteen");
  assert.deepEqual(outline(undefined, "Chapter Fifteen"), []);
  assert.deepEqual(outline(FIFTEEN.slice(0, 1), "Chapter Fifteen"), []);

  const showing = { book: "B.md", at: 3, line: 22 };
  assert.equal(markOf(showing, "B.md", entry(3, FIFTEEN), false), 22);
  assert.equal(markOf(showing, "B.md", entry(3, FIFTEEN), true), "entry");
});

test("the row for the page the preview shows is marked, heading rows included", () => {
  const lines = [13, 22, 31];
  const pages = [40, 41, 41];
  // Before the first heading the page is the entry's.
  assert.equal(headingOn(pages, lines, { first: 39, last: 39 }), undefined);
  assert.equal(headingOn(pages, lines, { first: 40, last: 40 }), 13);
  // Two headings open on one page, and the later one holds it.
  assert.equal(headingOn(pages, lines, { first: 41, last: 41 }), 31);
  assert.equal(headingOn(pages, lines, { first: 41, last: 41 }, 22), 22);
  // A spread holds a heading asked for on either of its pages.
  assert.equal(headingOn(pages, lines, { first: 40, last: 41 }, 22), 22);
  assert.equal(headingOn(pages, lines, { first: 42, last: 43 }, 22), 31);
  // A heading the engine gave no page is never the one marked.
  assert.equal(headingOn([undefined, 41, 41], lines, { first: 40, last: 40 }), undefined);

  const row = entry(3, FIFTEEN);
  assert.equal(markOf(undefined, "B.md", row, false), undefined);
  assert.equal(markOf({ book: "A.md", at: 3 }, "B.md", row, false), undefined);
  assert.equal(markOf({ book: "B.md", at: 4 }, "B.md", row, false), undefined);
  assert.equal(markOf({ book: "B.md", at: 3 }, "B.md", row, false), "entry");
  assert.equal(markOf({ book: "B.md", at: 3, line: 13 }, "B.md", row, false), 13);
  // A heading the row does not draw, such as the entry's own title.
  assert.equal(markOf({ book: "B.md", at: 3, line: 6 }, "B.md", row, false), "entry");
  assert.equal(markOf({ book: "B.md", at: 3, line: 13 }, "B.md", entry(3), false), "entry");
});

test("sections, entries and headings are one walk that stops at either end", () => {
  // A section, two entries and a heading row, in the order drawn.
  assert.equal(walk(4, 0, "ArrowDown"), 1);
  assert.equal(walk(4, 2, "ArrowDown"), 3);
  assert.equal(walk(4, 3, "ArrowDown"), 3);
  assert.equal(walk(4, 3, "ArrowUp"), 2);
  assert.equal(walk(4, 0, "ArrowUp"), 0);
  assert.equal(walk(4, 2, "Home"), 0);
  assert.equal(walk(4, 1, "End"), 3);
  assert.equal(walk(4, 1, "Enter"), undefined);
  assert.equal(walk(0, 0, "ArrowDown"), undefined);
});

// What this tier does not cover: the cache Obsidian builds, which the
// e2e job reads beside the rows, and the rows the navigator draws and
// the keys it listens for, which the e2e job presses.
