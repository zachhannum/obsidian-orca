import assert from "node:assert/strict";
import { test } from "node:test";
import { DESIGN_KEYS, LEVELS, emptyDesign, writeDesign } from "@/style/design";
import { effective } from "@/style/theme";
import {
  GROUPS,
  PANEL_KEYS,
  TRIMS,
  defaultSaid,
  keysOf,
  stepSaid,
  stepped,
  typed,
  withKey,
} from "@/ui/groups";

test("the panel offers every group a book designer works in", () => {
  assert.deepEqual(
    GROUPS.map((group) => group.name),
    [
      "Page",
      "Text",
      "Headings",
      "Chapter openings",
      "Scene breaks",
      "Heads & folios",
      "Page breaks",
    ],
  );
  for (const group of GROUPS) {
    assert.ok(group.rows.length > 0, `${group.name} offers no control`);
  }
});

test("the Headings group sets font, size and alignment at every level, and chapter openings set none", () => {
  const headings = GROUPS.find((group) => group.name === "Headings");
  const openings = GROUPS.find((group) => group.name === "Chapter openings");
  assert.ok(headings !== undefined && openings !== undefined);

  assert.deepEqual(
    new Set(keysOf(headings)),
    new Set(
      LEVELS.flatMap((level) =>
        ["font", "size", "align"].map((part) => `heading-${String(level)}-${part}`),
      ),
    ),
  );
  assert.deepEqual(
    keysOf(openings).filter((key) => key.startsWith("heading-")),
    [],
  );
});

test("every word the panel draws is spelled the American way", () => {
  const words = [
    ...TRIMS.map((trim) => trim.label),
    ...GROUPS.flatMap((group) => [
      group.name,
      group.hint ?? "",
      ...group.rows.flatMap((row) => [
        row.label,
        row.said ?? "",
        ...row.of.flatMap((control) => [
          control.said ?? "",
          ...(control.choices ?? []).map((choice) => choice.label),
        ]),
      ]),
    ]),
  ];
  for (const word of words) {
    assert.doesNotMatch(word, /centre|centred|colour|grey|isation|behaviour/i);
  }
});

test("every key the panel writes has a default, except the word a scene break is marked with", () => {
  const defaults = writeDesign(effective(emptyDesign()));
  for (const key of PANEL_KEYS) {
    if (key === "scene-break-word") continue;
    assert.notEqual(defaults[key], undefined, `\`${key}\` has no default`);
  }
  assert.equal(defaults["scene-break-word"], undefined);
});

test("a reset names the default in the words the control draws it with", () => {
  const [page, text] = GROUPS;
  const mirrored = page?.rows[2]?.of[0];
  const setting = text?.rows[4]?.of[0];
  assert.ok(mirrored !== undefined && setting !== undefined);
  assert.equal(defaultSaid(mirrored, true), "on");
  assert.equal(defaultSaid(setting, "justify"), "Justified");
  assert.equal(defaultSaid({ kind: "length", key: "body-size" }, "11pt"), "11pt");
  assert.equal(defaultSaid({ kind: "trim", key: "trim" }, "6in 9in"), "US trade — 6 × 9 in");
});

test("text a number field cannot read says what is wrong, and writes nothing", () => {
  assert.deepEqual(typed("length", "12px"), {
    wrong: "Use one of these units: pt, pc, in, mm, cm, em.",
  });
  assert.deepEqual(typed("length", "twelve"), {
    wrong: "Type a number and a unit, such as 12pt.",
  });
  assert.deepEqual(typed("length", "-2pt"), { wrong: "Use 0 or more." });
  assert.deepEqual(typed("count", "two"), {
    wrong: "Type a whole number of lines, such as 2.",
  });
  assert.deepEqual(typed("count", "1.5"), {
    wrong: "Type a whole number of lines, such as 2.",
  });
  // Text it can read is written the way the note writes it.
  assert.deepEqual(typed("length", "12"), { value: "12pt" });
  assert.deepEqual(typed("count", "3"), { value: 3 });
});

test("a number field steps by an amount that suits its unit", () => {
  assert.equal(stepped("length", "10.5pt", 1), "11pt");
  assert.equal(stepped("length", "0.8in", -1), "0.75in");
  assert.equal(stepped("length", "10pt", 1, 10), "15pt");
  assert.equal(stepped("count", "3", 1), 4);
  assert.equal(stepped("count", "0", -1), 0);
  assert.equal(stepped("length", "12px", 1), undefined);
  assert.equal(stepSaid("length", "10.5pt", 1), "Increase by 0.5pt");
  assert.equal(stepSaid("length", "0.8in", -1), "Decrease by 0.05in");
  assert.equal(stepSaid("count", "3", 1), "Increase by 1 line");
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
// row draws, whether a default is drawn faint, whether a switch takes a
// click, whether the glyphs or the word show for a mark, and whether a
// row fits the sidebar are the panel's own, and the e2e suite reads
// them off the mounted panel. The strings in `controls.tsx` and
// `panels.tsx` are not read for British spelling here.
