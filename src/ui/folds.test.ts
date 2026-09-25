import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allCollapsed,
  bookCollapsed,
  collapseAll,
  collapsedLines,
  entryCollapsed,
  expandAll,
  foldable,
  readFolds,
  withBook,
  withNote,
  type Folds,
} from "@/ui/folds";
import { outline, type Cached } from "@/ui/outline";
import type { Row, Shelved } from "@/ui/shelf";

const cache = (lines: number[]): Cached[] => [
  { heading: "The Parsonage", level: 1, position: { start: { line: lines[0] ?? 0 } } },
  { heading: "Notes", level: 2, position: { start: { line: lines[1] ?? 0 } } },
  { heading: "Notes", level: 2, position: { start: { line: lines[2] ?? 0 } } },
];

function row(lines: number[], path = "Fifteen.md"): Row {
  return {
    at: 0,
    name: "Chapter Fifteen",
    kind: "note",
    role: "chapter",
    named: false,
    path,
    headings: outline(cache(lines), "Chapter Fifteen"),
  };
}

function shelf(path: string, rows: Row[]): Shelved {
  return { path, name: path, groups: [{ heading: "Body", rows }], folder: "", holds: false };
}

test("a heading keeps its fold when text is written above it, and a sibling of one name keeps its own", () => {
  const before = row([3, 5, 7]);
  const second = before.headings?.[2];
  assert.ok(second !== undefined);
  const folds = withNote({}, "B.md", "Fifteen.md", true, second);
  assert.deepEqual(folds, {
    "B.md": {
      notes: {
        "Fifteen.md": { children: { "The Parsonage": [{ children: { Notes: [null, { collapsed: true }] } }] } },
      },
    },
  });
  assert.deepEqual([...collapsedLines(folds, "B.md", before)], [7]);
  // Ten lines written above every heading move none of the folds.
  assert.deepEqual([...collapsedLines(folds, "B.md", row([13, 15, 17]))], [17]);
  // A fold in one book leaves the same note in another open.
  assert.deepEqual([...collapsedLines(folds, "A.md", before)], []);
});

test("a fold opened again leaves nothing behind", () => {
  const second = row([3, 5, 7]).headings?.[2];
  assert.ok(second !== undefined);
  const shut = withNote({}, "B.md", "Fifteen.md", true, second);
  assert.deepEqual(withNote(shut, "B.md", "Fifteen.md", false, second), {});
  assert.deepEqual(withBook(withBook({}, "B.md", true), "B.md", false), {});
});

test("collapse all folds every entry that lists headings, and expand all keeps only the books", () => {
  const bare: Row = { at: 1, name: "Sixteen", kind: "note", role: "chapter", named: false, path: "Sixteen.md" };
  const books = [shelf("A.md", [row([3, 5, 7]), bare]), shelf("B.md", [row([3, 5, 7])])];
  assert.equal(foldable(books), true);
  assert.equal(foldable([shelf("A.md", [bare])]), false);

  const start: Folds = withBook({}, "A.md", true);
  assert.equal(allCollapsed(start, books), false);
  const collapsed = collapseAll(start, books);
  assert.equal(allCollapsed(collapsed, books), true);
  assert.equal(entryCollapsed(collapsed, "B.md", "Fifteen.md"), true);
  assert.equal(entryCollapsed(collapsed, "A.md", "Sixteen.md"), false);

  const expanded = expandAll(collapsed);
  assert.deepEqual(expanded, { "A.md": { collapsed: true } });
  assert.equal(bookCollapsed(expanded, "A.md"), true);
});

test("the folds a navigator saved read back, and anything else in the state folds nothing", () => {
  const folds: Folds = {
    "B.md": {
      collapsed: true,
      notes: { "Fifteen.md": { collapsed: true, children: { Notes: [null, { collapsed: true }] } } },
    },
  };
  assert.deepEqual(readFolds({ folds }), folds);
  assert.deepEqual(readFolds(JSON.parse(JSON.stringify({ folds })) as unknown), folds);
  assert.deepEqual(readFolds({ folds: { "B.md": { collapsed: "yes", notes: [] } } }), {});
  assert.deepEqual(readFolds({ folds: ["B.md"] }), {});
  assert.deepEqual(readFolds(undefined), {});
});

// What this tier does not cover: the view state Obsidian writes with the
// workspace and hands back on a reload, which the e2e job reloads the
// window for, and a heading renamed or moved under another parent,
// whose fold is let go by design.
