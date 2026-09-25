import assert from "node:assert/strict";
import { test } from "node:test";
import { DESIGN_KEYS, LEVELS, emptyDesign, writeDesign } from "@/style/design";
import type { Variant } from "@/assets/variants";
import { effective } from "@/style/theme";
import {
  GROUPS,
  PANEL_KEYS,
  atLevel,
  controlOf,
  defaultSaid,
  dimmed,
  ownerSaid,
  inUnit,
  keysOf,
  stepSaid,
  stepped,
  overriddenAt,
  trims,
  typed,
  withFont,
  withKey,
  withVariant,
  type Control,
} from "@/ui/groups";

/** The keys a scene break takes from the body when it sets none of its own. */
const SCENE_INHERITS = ["scene-break-font", "scene-break-size"];

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

test("the Page group offers the trim and the four margins, and no switch", () => {
  const page = GROUPS.find((group) => group.name === "Page");
  assert.ok(page !== undefined);

  assert.deepEqual(keysOf(page), [
    "trim",
    "margin-inside",
    "margin-outside",
    "margin-top",
    "margin-bottom",
  ]);
  // The side margins always mirror, so the group has nothing to switch.
  assert.deepEqual(
    page.rows.flatMap((row) => row.of).filter((control) => control.kind === "flag"),
    [],
  );
});

test("the Headings group sets the type and the space at every level, and chapter openings set none", () => {
  const headings = GROUPS.find((group) => group.name === "Headings");
  const openings = GROUPS.find((group) => group.name === "Chapter openings");
  assert.ok(headings !== undefined && openings !== undefined);

  assert.deepEqual(
    new Set(keysOf(headings)),
    new Set(
      LEVELS.flatMap((level) =>
        [
          "font",
          "font-variant",
          "style",
          "size",
          "caps",
          "letter-spacing",
          "align",
          "space-above",
          "space-below",
        ].map(
          (part) => `heading-${String(level)}-${part}`,
        ),
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

test("every key the panel writes has a default, except what a scene break takes from the body and a font's variant", () => {
  const defaults = writeDesign(effective(emptyDesign()));
  for (const key of PANEL_KEYS) {
    // A font's default variant is written as absent, and a scene break
    // with no face or size of its own takes the body's.
    if (SCENE_INHERITS.includes(key) || key.endsWith("-font-variant")) continue;
    assert.notEqual(defaults[key], undefined, `\`${key}\` has no default`);
  }
  for (const key of SCENE_INHERITS) assert.equal(defaults[key], undefined);
});

test("a reset names the default in the words the control draws it with", () => {
  assert.equal(defaultSaid(control("body-hyphens"), true, "in"), "on");
  assert.equal(defaultSaid(control("body-align"), "justify", "in"), "Justified");
  assert.equal(defaultSaid(control("body-size"), "11pt", "in"), "11pt");
  assert.equal(defaultSaid(control("trim"), "6in 9in", "in"), "US trade (6 × 9 in)");
  assert.equal(defaultSaid(control("chapter-drop-cap"), 0, "in"), "None");
  assert.equal(defaultSaid(control("page-number-format"), "roman", "in"), "i, ii, iii");
  // A page length comes out in the unit the author measures pages in.
  assert.equal(defaultSaid(control("margin-top"), "54pt", "in"), "0.75in");
  assert.equal(defaultSaid(control("trim"), "6in 9in", "mm"), "US trade (152.4 × 228.6 mm)");
});

test("the panel writes a picked variant under the font's variant key and clears it with the font", () => {
  const regular: Variant = { name: "Regular", isDefault: true, faces: [] };
  const cond: Variant = { name: "Cond", isDefault: false, faces: [] };
  let design = withFont(emptyDesign(), "heading-1-font", "Junicode");
  design = withVariant(design, "heading-1-font-variant", cond);
  assert.equal(writeDesign(design)["heading-1-font-variant"], "Cond");

  // The default variant is stored as absent.
  const back = withVariant(design, "heading-1-font-variant", regular);
  assert.equal(writeDesign(back)["heading-1-font-variant"], undefined);
  // A new font opens in its default variant, and a font reset takes its variant with it.
  const refonted = withFont(design, "heading-1-font", "Alegreya");
  assert.equal(writeDesign(refonted)["heading-1-font-variant"], undefined);
  const reset = writeDesign(withFont(design, "heading-1-font", undefined));
  assert.equal(reset["heading-1-font"], undefined);
  assert.equal(reset["heading-1-font-variant"], undefined);
});

test("a chapter begins on the next page unless the book says otherwise, and that choice is offered first", () => {
  const begins = control("chapter-begins");
  assert.equal(begins.choices?.[0]?.value, "next-page");
  assert.equal(writeDesign(effective(emptyDesign()))["chapter-begins"], "next-page");
});

test("a scene break is marked with a space or a glyph, and the glyph is set in a face and a size under it", () => {
  assert.deepEqual(
    control("scene-break-mark").choices?.map((choice) => choice.value),
    ["space", "ornament"],
  );

  const group = GROUPS.find((each) => each.name === "Scene breaks");
  assert.deepEqual(
    group?.rows.map((row) => row.label),
    ["Mark", "Glyph", "Font", "Style", "Size", "Space above", "Space below"],
  );
  assert.equal(control("scene-break-font").kind, "font");
  assert.equal(control("scene-break-size").kind, "length");
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
  // A length in em has no page unit to convert to. Text that is not a
  // length comes back as it is.
  assert.equal(inUnit("1.2em", "in"), "1.2em");
  assert.equal(inUnit("", "in"), "");
  // The field reads a bare number in the unit. A unit in the text still
  // wins.
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
  // Text it can read comes back as written in the note.
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
  // that the engine warns about none of them. A key in the schema is
  // enough here.
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
  // The schema does not read `px`, so the field snaps back to the size
  // the book already had.
  assert.deepEqual(writeDesign(withKey(design, "body-size", "10.5px")), {
    "body-size": "10.5pt",
  });
});

test("a generated rule names the control that wrote it", () => {
  // One key names its row.
  assert.deepEqual(controlOf({ keys: ["body-first-line-indent"] }), {
    group: "Text",
    row: "First-line indent",
    key: "body-first-line-indent",
  });
  // A row with no label uses the words of its switch.
  assert.equal(controlOf({ keys: ["body-hanging-punctuation"] })?.row, "Hanging punctuation");
  // Keys across rows of one group name the group.
  assert.deepEqual(controlOf({ keys: ["trim", "margin-inside"] }), {
    group: "Page",
    key: "trim",
  });
  // A heading key names its level.
  const heading = controlOf({ keys: ["heading-1-size", "heading-1-align"] });
  assert.deepEqual(heading, { group: "Headings", level: 1, key: "heading-1-size" });
  assert.equal(heading === undefined ? undefined : ownerSaid(heading), "Headings, H1");
  const size = controlOf({ keys: ["heading-2-size"] });
  assert.equal(size === undefined ? undefined : ownerSaid(size), "Size, H2");
  // A rule a role put there, with no key, names its layout and nothing to open.
  const title = controlOf({ keys: [], role: "title-page" });
  assert.deepEqual(title, { group: "Title page", layout: "title-page" });
  assert.equal(title === undefined ? undefined : ownerSaid(title), "title page");
  assert.equal(controlOf({ keys: [] }), undefined);
  assert.equal(controlOf({ keys: ["not-a-key"] }), undefined);
});

test("a row the author's CSS overrides is named by the line that overrides it", () => {
  const margins = ["margin-inside", "margin-outside", "margin-top", "margin-bottom"];
  const at = { sheet: "book.css", column: 3, declared: "margin", value: "1in", important: false };
  const top = { ...at, line: 7, property: "margin-top" };
  const bottom = { ...at, line: 4, property: "margin-bottom" };
  // The first key in row order names the row, whatever line it is on.
  assert.deepEqual(
    overriddenAt(margins, new Map([["margin-bottom", bottom], ["margin-top", top]])),
    { key: "margin-top", overrides: [top, bottom] },
  );
  // Two keys beaten by one declaration of one property give one card row.
  assert.deepEqual(
    overriddenAt(margins, new Map([["margin-top", top], ["margin-bottom", { ...top }]])),
    { key: "margin-top", overrides: [top] },
  );
  assert.equal(overriddenAt(margins, new Map([["body-size", top]])), undefined);
  assert.equal(overriddenAt([], new Map([["body-size", top]])), undefined);
});

test("the capitals and the tracking rows sit with the places they set", () => {
  const openings = GROUPS.find((group) => group.name === "Chapter openings");
  const headings = GROUPS.find((group) => group.name === "Headings");
  const heads = GROUPS.find((group) => group.name === "Heads & folios");
  assert.ok(openings !== undefined && headings !== undefined && heads !== undefined);

  assert.deepEqual(keysOf(openings), [
    "chapter-begins",
    "chapter-drop-cap",
    "chapter-drop-cap-font",
    "chapter-drop-cap-style",
    "chapter-first-line-caps",
    "chapter-first-line-letter-spacing",
  ]);
  assert.deepEqual(
    keysOf(headings).filter((key) => key.startsWith("heading-1-")),
    [
      "heading-1-font",
      "heading-1-font-variant",
      "heading-1-style",
      "heading-1-size",
      "heading-1-caps",
      "heading-1-letter-spacing",
      "heading-1-align",
      "heading-1-space-above",
      "heading-1-space-below",
    ],
  );
  assert.deepEqual(keysOf(heads).slice(6), [
    "header-font",
    "folio-font",
    "header-style",
    "folio-style",
    "header-caps",
    "header-letter-spacing",
    "suppress-head-on-openings",
  ]);

  // The first line takes two controls on one row, each said under it.
  assert.deepEqual(controlOf({ keys: ["chapter-first-line-caps"] }), {
    group: "Chapter openings",
    row: "First line",
    key: "chapter-first-line-caps",
  });
});

test("the drop cap font row sits under the drop cap row, and dims while the drop cap is None", () => {
  const openings = GROUPS.find((group) => group.name === "Chapter openings");
  assert.ok(openings !== undefined);
  const at = openings.rows.findIndex((row) =>
    row.of.some((control) => control.key === "chapter-drop-cap"),
  );
  const font = openings.rows[at + 1];
  assert.ok(font !== undefined);
  assert.deepEqual(font.of, [{ kind: "font", key: "chapter-drop-cap-font" }]);

  assert.equal(dimmed(font, { "chapter-drop-cap": 0 }), true);
  assert.equal(dimmed(font, {}), true);
  assert.equal(dimmed(font, { "chapter-drop-cap": 3 }), false);
  // Every other row is drawn as it always was.
  const cap = openings.rows[at];
  assert.ok(cap !== undefined);
  assert.equal(dimmed(cap, { "chapter-drop-cap": 0 }), false);
});

test("body text and every heading level share one alignment control, drawn with the alignment icons", () => {
  const drawn = (each: Control): string[] =>
    (each.choices ?? []).map((choice) => `${choice.value} ${choice.icon ?? "no icon"}`);
  const body = control("body-align");
  const heading = control("heading-N-align");

  // Every text block orca sets is aligned in the same control.
  assert.deepEqual(
    PANEL_KEYS.filter((key) => key.endsWith("-align")),
    ["body-align", ...LEVELS.map((level) => `heading-${String(level)}-align`)],
  );
  assert.equal(body.kind, "segment");
  assert.equal(heading.kind, "segment");
  assert.deepEqual(drawn(body), [
    "left align-left",
    "center align-center",
    "right align-right",
    "justify align-justify",
  ]);
  // The heading row drops justify and keeps the order of the rest.
  assert.deepEqual(drawn(heading), drawn(body).slice(0, 3));
  // The icon stands in for the word, and the word still names the value.
  assert.equal(defaultSaid(body, "center", "in"), "Center");
  assert.equal(defaultSaid(heading, "left", "in"), "Left");
});

test("the Heads & folios group picks the heading the chapter title is read from", () => {
  const heads = GROUPS.find((group) => group.name === "Heads & folios");
  assert.ok(heads !== undefined);

  // The row sits with the two slots it qualifies.
  assert.deepEqual(
    heads.rows.slice(0, 3).map((row) => row.label),
    ["Left-page header", "Right-page header", "Chapter title from"],
  );
  const picked = control("chapter-title-from");
  assert.equal(picked.kind, "select");
  assert.deepEqual(picked.choices?.map((choice) => choice.value), [
    "first",
    ...LEVELS.map((level) => `h${String(level)}`),
  ]);
  // The panel draws the default until the book picks a level, and a
  // pick writes the key and nothing else.
  assert.equal(defaultSaid(picked, writeDesign(effective(emptyDesign()))["chapter-title-from"], "in"), "First heading");
  assert.deepEqual(writeDesign(withKey(emptyDesign(), "chapter-title-from", "h2")), {
    "chapter-title-from": "h2",
  });
});

test("one font style control sets the weight and the slope wherever orca sets a place apart", () => {
  const styled = PANEL_KEYS.filter((key) => key.endsWith("-style"));

  // Every place orca sets apart from the body offers the control, and
  // each writes one key. The body takes its bold and italic from the
  // note. A chapter's first line offers none, because the engine drops
  // a style there.
  assert.deepEqual(styled, [
    ...LEVELS.map((level) => `heading-${String(level)}-style`),
    "chapter-drop-cap-style",
    "scene-break-style",
    "header-style",
    "folio-style",
  ]);
  assert.deepEqual(
    GROUPS.flatMap((group) => group.rows)
      .flatMap((row) => row.of)
      .filter((each) => each.kind === "style")
      .map((each) => each.key),
    [
      "heading-N-style",
      "chapter-drop-cap-style",
      "scene-break-style",
      "header-style",
      "folio-style",
    ],
  );
  assert.ok(!PANEL_KEYS.includes("body-style"));
  assert.ok(!PANEL_KEYS.includes("chapter-first-line-style"));
  assert.ok(!PANEL_KEYS.includes("header-italic"));

  // The control is a select that names the four styles.
  assert.deepEqual(control("header-style").choices?.map((choice) => choice.label), [
    "Normal",
    "Bold",
    "Italic",
    "Bold italic",
  ]);
  // The name the reset says is the word the control is drawn with.
  assert.equal(defaultSaid(control("folio-style"), "bold-italic", "in"), "Bold italic");
  assert.equal(defaultSaid(control("header-style"), "normal", "in"), "Normal");
});

// What this tier does not cover: the drawing itself. The e2e suite
// reads it off the mounted panel. It checks which control a row draws
// and whether a default is drawn faint. It checks whether a switch
// takes a click, whether a mark shows the glyphs or the word, and
// whether a row fits the sidebar. This file does not check the strings
// in `controls.tsx` and `panels.tsx` for British spelling.
