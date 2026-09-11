import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDesign } from "@/style/design";
import { withKey } from "@/ui/groups";
import { summary } from "@/ui/summary";

function value(lines: ReturnType<typeof summary>, label: string): string | undefined {
  return lines.find((line) => line.label === label)?.value;
}

test("a book that sets nothing is summed up in its defaults, in the panel's words", () => {
  const lines = summary(emptyDesign(), "in");
  assert.deepEqual(
    lines.map((line) => line.label),
    [
      "Trim",
      "Margins",
      "Text",
      "Chapters begin on",
      "Scene breaks",
      "Running heads",
      "Page numbers",
    ],
  );
  assert.equal(value(lines, "Trim"), "US trade (6 × 9 in)");
  assert.equal(value(lines, "Text"), "EB Garamond, 11pt on 16.5pt, justified");
  assert.equal(value(lines, "Chapters begin on"), "Next page");
  assert.equal(value(lines, "Running heads"), "None");
  assert.equal(value(lines, "Page numbers"), "Bottom (1, 2, 3)");
});

test("the summary measures the page in the unit the author picked", () => {
  const lines = summary(emptyDesign(), "mm");
  assert.equal(value(lines, "Trim"), "US trade (152.4 × 228.6 mm)");
  assert.match(value(lines, "Margins") ?? "", /^19\.05mm inside, /);

  const custom = withKey(emptyDesign(), "trim", "5in 8in");
  assert.equal(value(summary(custom, "mm"), "Trim"), "127mm × 203.2mm");
});

test("the summary follows the keys the book sets", () => {
  let design = withKey(emptyDesign(), "scene-break-mark", "word");
  design = withKey(design, "scene-break-word", "Later");
  design = withKey(design, "header-left-page", "author");
  design = withKey(design, "header-right-page", "chapter-title");
  const lines = summary(design, "in");
  assert.equal(value(lines, "Scene breaks"), "Later");
  assert.equal(
    value(lines, "Running heads"),
    "author on left pages, chapter title on right pages",
  );
});

// What this tier does not cover: the book note's page that shows the
// summary, and the button beside it that opens the panel. The e2e suite
// reads both off that page.
