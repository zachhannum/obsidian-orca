import assert from "node:assert/strict";
import { test } from "node:test";
import { DESIGN_KEYS, LEVELS, emptyDesign, writeDesign } from "@/style/design";
import { effective } from "@/style/theme";
import {
  GROUPS,
  PANEL_KEYS,
  atLevel,
  defaultSaid,
  inUnit,
  keysOf,
  stepSaid,
  stepped,
  trims,
  typed,
  withKey,
  type Control,
} from "@/ui/groups";

/** The control that writes `key`. */
function control(key: string): Control {
  const found = GROUPS.flatMap((group) => group.rows)
    .flatMap((row) => row.of)
    .find((each) => each.key === key);
  assert.ok(found !== undefined, `no control writes \`${key}\``);
  return found;
}

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
    ...trims("in").map((trim) => trim.label),
    ...GROUPS.flatMap((group) => [
      group.name,
      ...group.rows.flatMap((row) => [
        row.label,
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
  assert.equal(defaultSaid(control("mirrored"), true, "in"), "on");
  assert.equal(defaultSaid(control("body-align"), "justify", "in"), "Justified");
  assert.equal(defaultSaid(control("body-size"), "11pt", "in"), "11pt");
  assert.equal(defaultSaid(control("trim"), "6in 9in", "in"), "US trade (6 × 9 in)");
  assert.equal(defaultSaid(control("chapter-drop-cap"), 0, "in"), "None");
  assert.equal(defaultSaid(control("page-number-format"), "roman", "in"), "i, ii, iii");
  // A page length is named in the unit the author measures pages in.
  assert.equal(defaultSaid(control("margin-top"), "54pt", "in"), "0.75in");
  assert.equal(defaultSaid(control("trim"), "6in 9in", "mm"), "US trade (152.4 × 228.6 mm)");
});

test("a chapter begins on the next page unless the book says otherwise, and that choice is offered first", () => {
  const begins = control("chapter-begins");
  assert.equal(begins.choices?.[0]?.value, "next-page");
  assert.equal(writeDesign(effective(emptyDesign()))["chapter-begins"], "next-page");
});

test("every word a select or a segment offers is a value the schema reads back", () => {
  for (const each of GROUPS.flatMap((group) => group.rows).flatMap((row) => row.of)) {
    if (each.key === undefined || each.kind === "level") continue;
    const key = atLevel(each.key, 1);
    for (const choice of each.choices ?? []) {
      const design = withKey(emptyDesign(), key, choice.value);
      assert.equal(
        String(writeDesign(design)[key]),
        choice.value,
        `\`${key}\` does not read back \`${choice.value}\``,
      );
    }
  }
});

test("a page length is drawn, typed and stepped in the unit the author measures pages in", () => {
  assert.equal(inUnit("54pt", "in"), "0.75in");
  assert.equal(inUnit("54pt", "mm"), "19.05mm");
  assert.equal(inUnit("0.75in", "pt"), "54pt");
  // A length in em has no page unit to go into, and text that is not a
  // length is drawn as it is.
  assert.equal(inUnit("1.2em", "in"), "1.2em");
  assert.equal(inUnit("", "in"), "");
  // A bare number is read in the unit, and a written unit still wins.
  assert.deepEqual(typed("length", "0.8", "in"), { value: "0.8in" });
  assert.deepEqual(typed("length", "20mm", "in"), { value: "20mm" });
  assert.equal(stepped("length", "0.75", 1, 1, "in"), "0.8in");
  assert.equal(stepSaid("length", "", 1, "mm"), "Increase by 1mm");
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
  for (const trim of trims("mm")) {
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
