import assert from "node:assert/strict";
import { test } from "node:test";
import { GENERATED_ORIGIN } from "@/book/plan";
import { DESIGN_SHEET, OWN_SHEET } from "@/style/sheet";
import { THEME_SHEET } from "@/style/theme";
import { cssFlags, routeOf } from "@/ui/warnings";

const MESSAGE = "unsupported property `position`";

test("a warning against a generated section goes to the console, and one against a note is the author's", () => {
  assert.equal(routeOf({ message: MESSAGE, origin: `${GENERATED_ORIGIN}:0:1:1` }), "orca");
  assert.equal(routeOf({ message: MESSAGE, origin: "Chapter Twelve.md:6:1" }), "note");
  // A note may be named like the prefix, but no note name has its colon.
  assert.equal(routeOf({ message: MESSAGE, origin: `${GENERATED_ORIGIN}.md:1:1` }), "note");
  assert.equal(routeOf({ message: MESSAGE, origin: null }), "note");
});

test("a warning in orca.css or design.css is orca's defect, and one in book.css goes to the editor", () => {
  assert.equal(routeOf({ message: MESSAGE, origin: `${THEME_SHEET}:2:3` }), "orca");
  assert.equal(routeOf({ message: MESSAGE, origin: `${DESIGN_SHEET}:40:5` }), "orca");
  assert.equal(routeOf({ message: MESSAGE, origin: `${OWN_SHEET}:8:3` }), "css");
  // Only the sheet's whole name routes a warning.
  assert.equal(routeOf({ message: MESSAGE, origin: `${OWN_SHEET}.md:8:3` }), "note");
});

test("the editor is flagged with the book.css warnings alone, at the place each one named", () => {
  const flags = cssFlags([
    { message: MESSAGE, origin: `${OWN_SHEET}:8:3` },
    { message: MESSAGE, origin: `${DESIGN_SHEET}:8:3` },
    { message: MESSAGE, origin: "Chapter Twelve.md:6:1" },
    { message: MESSAGE, origin: null },
  ]);
  assert.deepEqual(flags, [{ sheet: OWN_SHEET, line: 8, column: 3, message: MESSAGE }]);
});

// What this tier does not cover: the console itself, and the preview's
// warning cards, which the e2e suite reads.
