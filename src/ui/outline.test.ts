import assert from "node:assert/strict";
import { test } from "node:test";
import {
  folds,
  headingOn,
  levelsTo,
  markOf,
  outline,
  parentOf,
  unfolded,
  walk,
  type Cached,
} from "@/ui/outline";
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
    { line: 13, words: "The Parsonage", depth: 0, trail: [{ words: "The Parsonage", nth: 0 }] },
    {
      line: 22,
      words: "The Entail",
      depth: 1,
      trail: [
        { words: "The Parsonage", nth: 0 },
        { words: "The Entail", nth: 0 },
      ],
    },
    {
      line: 31,
      words: "A Morning Call Longbourn, in the Spring",
      depth: 1,
      trail: [
        { words: "The Parsonage", nth: 0 },
        { words: "A Morning Call Longbourn, in the Spring", nth: 0 },
      ],
    },
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
  // A span the entry opens in is the entry's, unless a heading in it was asked for.
  assert.equal(headingOn(pages, lines, { first: 40, last: 40 }, undefined, 40), undefined);
  assert.equal(headingOn(pages, lines, { first: 41, last: 41 }, undefined, 40), 31);
  assert.equal(headingOn(pages, lines, { first: 40, last: 40 }, 13, 40), 13);
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

test("an entry lists its headings down to the level the author picked", () => {
  assert.deepEqual(outline(levelsTo(FIFTEEN, 1), "Chapter Fifteen"), [
    { line: 13, words: "The Parsonage", depth: 0, trail: [{ words: "The Parsonage", nth: 0 }] },
  ]);
  assert.equal(outline(levelsTo(FIFTEEN, 2), "Chapter Fifteen").length, 3);
  assert.equal(levelsTo(undefined, 1), undefined);
});

test("a heading with deeper headings under it folds them away, and marks the page they hold", () => {
  const headings = outline(FIFTEEN, "Chapter Fifteen");
  // The Parsonage holds the two below it, and they hold nothing.
  assert.deepEqual(headings.map((_, index) => folds(headings, index)), [true, false, false]);
  assert.deepEqual(headings.map((_, index) => parentOf(headings, index)), [undefined, 13, 13]);

  assert.deepEqual(unfolded(headings, new Set([13])).map((heading) => heading.line), [13]);
  // A fold on a heading with nothing under it leaves every row drawn.
  assert.equal(unfolded(headings, new Set([22])).length, 3);

  const showing = { book: "B.md", at: 3, line: 22 };
  assert.equal(markOf(showing, "B.md", entry(3, FIFTEEN), false, new Set([13])), 13);
  assert.equal(markOf(showing, "B.md", entry(3, FIFTEEN), false, new Set()), 22);
});

test("a heading's trail is its words under the headings above it, and counts siblings of one name", () => {
  const twice: Cached[] = [
    { heading: "Part", level: 1, position: { start: { line: 0 } } },
    { heading: "Notes", level: 2, position: { start: { line: 2 } } },
    { heading: "Notes", level: 2, position: { start: { line: 4 } } },
    { heading: "Other", level: 1, position: { start: { line: 6 } } },
    { heading: "Notes", level: 2, position: { start: { line: 8 } } },
  ];
  assert.deepEqual(
    outline(twice, "Chapter").map((heading) => heading.trail.map((step) => `${step.words}#${String(step.nth)}`).join(" > ")),
    ["Part#0", "Part#0 > Notes#0", "Part#0 > Notes#1", "Other#0", "Other#0 > Notes#0"],
  );
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
// the keys it listens for, which the e2e job presses. Nor a heading
// asked about while the note has typed words not yet saved: the cache
// counts lines on disk and the engine counts the text it holds, so
// the page can be the one the line opened on before the edit.
