import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDesign, type Design } from "@/style/design";
import { GROUPS, withKey } from "@/ui/groups";
import { summary } from "@/ui/summary";

/** A group's facts as `label: value` lines, with a `*` before one the book set. */
function facts(design: Design, group: string, unit: "in" | "mm" = "in"): string[] {
  const found = summary(design, unit).find((each) => each.label === group);
  return (found?.facts ?? []).map(
    (fact) => `${fact.set ? "*" : ""}${fact.label}: ${fact.value}`,
  );
}

test("the summary has one block for each group of the panel, in the panel's order", () => {
  const groups = summary(emptyDesign(), "in");
  assert.deepEqual(
    groups.map((each) => each.label),
    GROUPS.map((group) => group.name),
  );
  for (const each of groups) assert.notEqual(each.facts.length, 0, each.label);
});

test("a book that sets nothing shows the rows the panel marks, each under its own label", () => {
  const design = emptyDesign();
  assert.deepEqual(facts(design, "Page"), [
    "Trim: US trade (6 × 9 in)",
    "Margins inside: 0.75in",
    "Margins outside: 0.6in",
    "Margins top: 0.75in",
    "Margins bottom: 0.75in",
  ]);
  assert.deepEqual(facts(design, "Text"), [
    "Font: EB Garamond",
    "Size: 11pt",
    "Line spacing: 16.5pt",
    "Alignment: Justified",
  ]);
  assert.deepEqual(facts(design, "Chapter openings"), [
    "Begins on: Next page",
    "Drop cap: None",
  ]);
  assert.deepEqual(facts(design, "Scene breaks"), ["Mark: Ornament", "Glyph: ❧"]);
  assert.deepEqual(facts(design, "Headers & page numbers"), [
    "Left-page header: Nothing",
    "Right-page header: Nothing",
    "Page number: Bottom",
    "Number format: 1, 2, 3",
  ]);
  assert.deepEqual(facts(design, "Page breaks"), [
    "Orphans: 2 lines",
    "Widows: 2 lines",
  ]);
});

test("a row the panel does not mark is shown once the book moves it off the default", () => {
  let design = withKey(emptyDesign(), "body-hanging-punctuation", true);
  design = withKey(design, "keep-heading-with-text", false);
  // A key written at its default is not a change.
  design = withKey(design, "body-hyphens", true);
  assert.deepEqual(facts(design, "Text"), [
    "Font: EB Garamond",
    "Size: 11pt",
    "Line spacing: 16.5pt",
    "Alignment: Justified",
    "*Hanging punctuation: On",
  ]);
  assert.deepEqual(facts(design, "Page breaks"), [
    "Orphans: 2 lines",
    "Widows: 2 lines",
    "*Keep a heading with what follows it: Off",
  ]);
});

test("a fact is set only when the book moves its key off the default", () => {
  for (const group of summary(emptyDesign(), "in")) {
    assert.deepEqual(group.facts.filter((fact) => fact.set), [], group.label);
  }

  let design = withKey(emptyDesign(), "body-font", "Alegreya");
  design = withKey(design, "body-orphans", 2);
  assert.deepEqual(facts(design, "Text")[0], "*Font: Alegreya");
  assert.deepEqual(facts(design, "Page breaks")[0], "Orphans: 2 lines");
  // The headings take the body's font, and the book did not set theirs.
  assert.deepEqual(facts(design, "Headings")[0], "H1 font: Alegreya");
});

test("the Headings block gives H1, and each other level the book sets", () => {
  assert.deepEqual(facts(emptyDesign(), "Headings"), [
    "H1 font: EB Garamond",
    "H1 size: 19pt",
    "H1 alignment: Left",
  ]);

  let design = withKey(emptyDesign(), "heading-1-caps", "small-caps");
  design = withKey(design, "heading-3-style", "italic");
  assert.deepEqual(facts(design, "Headings"), [
    "H1 font: EB Garamond",
    "H1 size: 19pt",
    "*H1 capitals: Small caps",
    "H1 alignment: Left",
    "H3 font: EB Garamond",
    "*H3 style: Italic",
    "H3 size: 19pt",
    "H3 alignment: Left",
  ]);
});

test("a heading level and a row of several controls each begin a line", () => {
  let design = withKey(emptyDesign(), "heading-2-space-below", 1);
  design = withKey(design, "chapter-first-line-caps", "small-caps");
  const starts = summary(design, "in").flatMap((group) =>
    group.facts.filter((fact) => fact.starts).map((fact) => fact.label),
  );
  assert.deepEqual(starts, [
    "Margins inside",
    "H1 font",
    "H2 font",
    "First line capitals",
  ]);
  assert.equal(facts(design, "Headings").at(-1), "*H2 space below: 1 line");
});

test("a scene break that is a space shows no glyph", () => {
  const design = withKey(emptyDesign(), "scene-break-mark", "space");
  assert.deepEqual(facts(design, "Scene breaks"), ["*Mark: Space"]);
});

test("the summary measures the page in the unit the author picked", () => {
  assert.deepEqual(facts(emptyDesign(), "Page", "mm").slice(0, 2), [
    "Trim: US trade (152.4 × 228.6 mm)",
    "Margins inside: 19.05mm",
  ]);

  const custom = withKey(emptyDesign(), "trim", "5in 8in");
  assert.equal(facts(custom, "Page", "mm")[0], "*Trim: 127mm × 203.2mm");
});

// What this tier does not cover: the book note's page that draws the
// facts, and the muted color of a value the book leaves at its default.
// The e2e suite reads both off that page.
