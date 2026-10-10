import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDesign } from "@/style/design";
import { GROUPS, withKey } from "@/ui/groups";
import { summary } from "@/ui/summary";

function line(
  lines: ReturnType<typeof summary>,
  label: string,
): ReturnType<typeof summary>[number] | undefined {
  return lines.find((each) => each.label === label);
}

function value(lines: ReturnType<typeof summary>, label: string): string | undefined {
  return line(lines, label)?.value;
}

test("the summary has one line for each group of the panel, in the panel's order", () => {
  const lines = summary(emptyDesign(), "in");
  assert.deepEqual(
    lines.map((each) => each.label),
    GROUPS.map((group) => group.name),
  );
  assert.equal(
    value(lines, "Page"),
    "US trade (6 × 9 in). Margins 0.75in inside, 0.6in outside, 0.75in top, 0.75in bottom.",
  );
  assert.equal(
    value(lines, "Text"),
    "EB Garamond, 11pt on 16.5pt, justified, 1.2em indent, hyphenated",
  );
  assert.equal(value(lines, "Chapter openings"), "Next page, no drop cap");
  assert.equal(value(lines, "Scene breaks"), "❧");
  assert.equal(
    value(lines, "Headers & page numbers"),
    "No headers. Page numbers at the bottom (1, 2, 3).",
  );
});

test("no group of the panel has an empty line", () => {
  for (const each of summary(emptyDesign(), "in")) {
    assert.notEqual(each.value, "", each.label);
  }
});

test("the Headings line gives H1 and each other level the book sets", () => {
  assert.equal(
    value(summary(emptyDesign(), "in"), "Headings"),
    "H1 EB Garamond 19pt, left",
  );

  let design = withKey(emptyDesign(), "body-font", "Alegreya");
  design = withKey(design, "heading-1-align", "center");
  design = withKey(design, "heading-1-caps", "small-caps");
  design = withKey(design, "heading-3-style", "italic");
  design = withKey(design, "heading-3-size", "12pt");
  assert.equal(
    value(summary(design, "in"), "Headings"),
    "H1 Alegreya 19pt, small caps, center. H3 Alegreya 12pt, italic, left",
  );
});

test("the Page breaks line gives the orphans, the widows and the heading rule", () => {
  assert.equal(
    value(summary(emptyDesign(), "in"), "Page breaks"),
    "Orphans 2 lines, widows 2 lines, a heading stays with what follows it",
  );

  let design = withKey(emptyDesign(), "body-widows", 3);
  design = withKey(design, "keep-heading-with-text", false);
  assert.equal(
    value(summary(design, "in"), "Page breaks"),
    "Orphans 2 lines, widows 3 lines, a heading can end a page",
  );
});

test("a line is set only when the book moves a key of its group off the default", () => {
  assert.deepEqual(
    summary(emptyDesign(), "in").filter((each) => each.set),
    [],
  );

  // A body font is a Text key. The headings take it, and stay unset.
  let design = withKey(emptyDesign(), "body-font", "Alegreya");
  design = withKey(design, "chapter-drop-cap", 3);
  // A key written at its default sets nothing.
  design = withKey(design, "body-orphans", 2);
  assert.deepEqual(
    summary(design, "in")
      .filter((each) => each.set)
      .map((each) => each.label),
    ["Text", "Chapter openings"],
  );
});

test("the summary measures the page in the unit the author picked", () => {
  const lines = summary(emptyDesign(), "mm");
  assert.match(
    value(lines, "Page") ?? "",
    /^US trade \(152\.4 × 228\.6 mm\)\. Margins 19\.05mm inside, /,
  );

  const custom = withKey(emptyDesign(), "trim", "5in 8in");
  assert.match(value(summary(custom, "mm"), "Page") ?? "", /^127mm × 203\.2mm\. /);
});

test("the summary follows the keys the book sets", () => {
  let design = withKey(emptyDesign(), "scene-break-mark", "ornament");
  design = withKey(design, "scene-break-ornament", "*");
  design = withKey(design, "header-left-page", "author");
  design = withKey(design, "header-right-page", "chapter-title");
  design = withKey(design, "chapter-drop-cap", 3);
  design = withKey(design, "chapter-first-line-caps", "small-caps");
  const lines = summary(design, "in");
  assert.equal(value(lines, "Scene breaks"), "*");
  assert.equal(
    value(lines, "Headers & page numbers"),
    "Author on left pages, chapter title on right pages. Page numbers at the bottom (1, 2, 3).",
  );
  assert.equal(
    value(lines, "Chapter openings"),
    "Next page, drop cap of 3 lines, first line in small caps",
  );
  assert.equal(
    value(summary(withKey(design, "scene-break-mark", "space"), "in"), "Scene breaks"),
    "A blank line",
  );
});

// What this tier does not cover: the book note's page that draws the
// lines, and the muted color of a line the book leaves at its defaults.
// The e2e suite reads both off that page.
