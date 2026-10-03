import assert from "node:assert/strict";
import { test } from "node:test";
import { GENERATED_ORIGIN } from "@/book/plan";
import { DESIGN_SHEET, FACES_SHEET, OWN_SHEET } from "@/style/sheet";
import { THEME_SHEET } from "@/style/theme";
import {
  cssFlags,
  fontGroup,
  groupTitle,
  tally,
  issueGroups,
  routeOf,
  withEpub,
} from "@/ui/issues";

const MESSAGE = "unsupported property `position`";

test("a warning against a generated section goes to the console, and one against a note is the author's", () => {
  assert.equal(routeOf({ message: MESSAGE, origin: `${GENERATED_ORIGIN}:0:1:1` }), "orca");
  assert.equal(routeOf({ message: MESSAGE, origin: "Chapter Twelve.md:6:1" }), "note");
  // A note may be named like the prefix, but no note name has its colon.
  assert.equal(routeOf({ message: MESSAGE, origin: `${GENERATED_ORIGIN}.md:1:1` }), "note");
  assert.equal(routeOf({ message: MESSAGE, origin: null }), "note");
});

test("a warning in orca.css, faces.css or design.css is orca's defect, and one in book.css goes to the editor", () => {
  assert.equal(routeOf({ message: MESSAGE, origin: `${THEME_SHEET}:2:3` }), "orca");
  assert.equal(routeOf({ message: MESSAGE, origin: `${FACES_SHEET}:1:1` }), "orca");
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

test("the author's warnings are grouped by note, each at its line, and orca's are left out", () => {
  const groups = issueGroups([
    { message: "a", origin: "Part One/Chapter Eleven.md:84:1" },
    { message: "b", origin: `${GENERATED_ORIGIN}:0:1:1` },
    { message: "c", origin: `${OWN_SHEET}:8:3` },
    { message: "d", origin: "Part One/Chapter Eleven.md:121:5" },
    { message: "e", origin: `${THEME_SHEET}:2:3` },
    { message: "f", origin: null },
  ]);
  assert.deepEqual(groups, [
    {
      route: "note",
      source: "Part One/Chapter Eleven.md",
      issues: [
        { message: "a", place: { sheet: "Part One/Chapter Eleven.md", line: 84, column: 1 } },
        { message: "d", place: { sheet: "Part One/Chapter Eleven.md", line: 121, column: 5 } },
      ],
    },
    {
      route: "css",
      source: OWN_SHEET,
      issues: [{ message: "c", place: { sheet: OWN_SHEET, line: 8, column: 3 } }],
    },
    { route: "note", source: null, issues: [{ message: "f", place: undefined }] },
  ]);
  assert.deepEqual(groups.map(groupTitle), ["Chapter Eleven", "The book's CSS", "Other"]);
});

test("an EPUB's warnings join the run's as the engine wrote them, each said once", () => {
  const run = [{ message: MESSAGE, origin: `${OWN_SHEET}:4:3` }];
  const epub = [
    { message: MESSAGE, origin: `${OWN_SHEET}:4:3` },
    { message: "a link to `#nowhere` reaches nothing", origin: "Chapter Twelve.md:6:1" },
  ];

  assert.deepEqual(withEpub(run, epub), [run[0], epub[1]]);
  assert.deepEqual(withEpub([], epub), epub);
});

test("the fonts a book does not get are one group named Fonts, with no place to open, and none when there are none", () => {
  assert.deepEqual(fontGroup([]), []);
  const groups = fontGroup(["Missing font: Junicode", "Missing font: Alegreya"]);
  assert.deepEqual(groups.map(groupTitle), ["Fonts"]);
  assert.deepEqual(groups[0]?.issues, [
    { message: "Missing font: Junicode", place: undefined },
    { message: "Missing font: Alegreya", place: undefined },
  ]);
});

test("the count says the errors first and then the warnings, and leaves out a kind there is none of", () => {
  assert.equal(tally(0, 1), "1 warning");
  assert.equal(tally(0, 3), "3 warnings");
  assert.equal(tally(1, 0), "1 error");
  assert.equal(tally(2, 1), "2 errors, 1 warning");
});

// What this tier does not cover: the console itself, the preview's
// warning cards and what a click on one opens, which the e2e suite
// reads.
