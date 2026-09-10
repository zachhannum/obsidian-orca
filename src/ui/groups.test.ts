import assert from "node:assert/strict";
import { test } from "node:test";
import { DESIGN_KEYS, emptyDesign, writeDesign } from "@/style/design";
import { GROUPS, PANEL_KEYS, TRIMS, withKey } from "@/ui/groups";

test("the panel offers every group a book designer works in", () => {
  assert.deepEqual(
    GROUPS.map((group) => group.name),
    [
      "Preset",
      "Page",
      "Text",
      "Chapter openings",
      "Scene breaks",
      "Heads & folios",
      "Discipline",
    ],
  );
  for (const group of GROUPS) {
    assert.ok(group.rows.length > 0, `${group.name} offers no control`);
  }
});

test("no control can produce a warning, because each one writes a design key", () => {
  for (const key of PANEL_KEYS) {
    assert.ok(DESIGN_KEYS.includes(key), `the schema has no \`${key}\``);
  }
  // `design.test.ts` renders every property the schema sets and asserts
  // the engine warns about none of it, so a key is the whole proof.
  assert.ok(PANEL_KEYS.length > 0);
});

test("the trims on offer are the ones the schema reads back", () => {
  for (const trim of TRIMS) {
    const design = withKey(emptyDesign(), "trim", trim.value);
    assert.equal(writeDesign(design)["trim"], trim.value);
  }
});

test("a control writes its own key and leaves the rest of the design alone", () => {
  const design = withKey(
    withKey(emptyDesign(), "body-size", "10.5pt"),
    "chapter-drop-cap",
    3,
  );
  assert.deepEqual(writeDesign(design), {
    "body-size": "10.5pt",
    "chapter-drop-cap": 3,
  });

  const cleared = withKey(design, "body-size", undefined);
  assert.deepEqual(writeDesign(cleared), { "chapter-drop-cap": 3 });
});

test("a length the schema cannot read leaves the design as it was", () => {
  const design = withKey(emptyDesign(), "body-size", "10.5pt");
  // `px` is not a unit the schema reads, so the field snaps back to the
  // size the book already had rather than losing it.
  assert.deepEqual(writeDesign(withKey(design, "body-size", "10.5px")), {
    "body-size": "10.5pt",
  });
});

// What this tier does not cover: the drawing itself. Which control a
// row draws, and whether the glyphs or the word show for a mark, are
// the panel's own, and the e2e suite reads them off the mounted panel.
