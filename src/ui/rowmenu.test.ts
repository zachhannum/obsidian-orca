import assert from "node:assert/strict";
import { test } from "node:test";
import { entryItems, headingItems, menuPlace, menuTitle } from "@/ui/rowmenu";

const NOTE = { kind: "note", path: "Chapter Twelve.md" } as const;

test("a chapter's menu on a phone and a tablet opens the note as markdown and the preview, over the desktop's items", () => {
  const desktop = entryItems("desktop", NOTE);
  assert.deepEqual(desktop, [["chapter", "role", "reveal"], ["remove"]]);
  for (const device of ["phone", "tablet"] as const) {
    assert.deepEqual(entryItems(device, NOTE), [["markdown", "preview"], ...desktop]);
  }
});

test("a generated section has a preview and no note to open", () => {
  assert.deepEqual(entryItems("phone", { kind: "generated" }), [
    ["preview"],
    ["chapter", "role"],
    ["remove"],
  ]);
});

test("a missing note has nothing to open, and its menu locates it", () => {
  assert.deepEqual(entryItems("phone", { kind: "missing" }), [
    ["chapter", "role", "locate"],
    ["remove"],
  ]);
  assert.deepEqual(entryItems("desktop", { kind: "missing" }), [
    ["chapter", "role", "locate"],
    ["remove"],
  ]);
});

test("only a phone's sheet has a title", () => {
  assert.equal(menuTitle("phone", "Chapter Twelve"), "Chapter Twelve");
  assert.equal(menuTitle("tablet", "Chapter Twelve"), undefined);
  assert.equal(menuTitle("desktop", "Chapter Twelve"), undefined);
});

test("a tablet's menu is at the end of the row, and the desktop's is at the pointer", () => {
  const row = { top: 300, right: 450 };
  const pointer = { x: 120, y: 310 };
  assert.deepEqual(menuPlace("tablet", row, pointer), { x: 450, y: 300 });
  assert.deepEqual(menuPlace("desktop", row, pointer), pointer);
  assert.deepEqual(menuPlace("phone", row, pointer), pointer);
});

test("a book's headings menu names the default and checks the book's own choice", () => {
  const checked = (own: number | undefined) =>
    headingItems(own, 3)
      .filter((item) => item.checked)
      .map((item) => item.title);

  assert.deepEqual(
    headingItems(undefined, 3).map((item) => [item.title, item.value]),
    [
      ["Use the default (3 levels)", undefined],
      ["Hidden", 0],
      ["1 level", 1],
      ["2 levels", 2],
      ["3 levels", 3],
      ["4 levels", 4],
      ["5 levels", 5],
      ["All levels", 6],
    ],
  );
  assert.equal(headingItems(undefined, undefined)[0]?.title, "Use the default (hidden)");
  assert.equal(headingItems(undefined, 1)[0]?.title, "Use the default (1 level)");
  assert.equal(headingItems(undefined, 6)[0]?.title, "Use the default (all levels)");

  assert.deepEqual(checked(undefined), ["Use the default (3 levels)"]);
  assert.deepEqual(checked(0), ["Hidden"]);
  // A book set to the level the settings list still checks its own.
  assert.deepEqual(checked(3), ["3 levels"]);
});

// What this tier does not cover: the menu itself, which is Obsidian's
// and which the e2e suite opens at a phone's size and a tablet's.
