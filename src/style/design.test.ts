import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Client, createEngine, styleOp } from "fleuron";
import { readFrontmatter } from "@/book/frontmatter";
import { FORMAT, readBook, writeNote } from "@/book/note";
import {
  BOOK_SIZES,
  DESIGN_KEYS,
  DESIGN_PROPERTIES,
  LEVELS,
  PAGE_UNITS,
  STEPS,
  UNITS,
  ValueError,
  convertLength,
  designFonts,
  designUses,
  emptyDesign,
  mergeDesign,
  parseCount,
  parseLength,
  propertiesOf,
  readDesign,
  stepCount,
  stepLength,
  writeDesign,
  type Design,
  type Length,
} from "@/style/design";

const root = process.env["ORCA_ROOT"] ?? process.cwd();

test("the schema sets only properties the pinned engine reads", async () => {
  const css = await subset();
  for (const property of DESIGN_PROPERTIES) {
    assert.match(
      css,
      new RegExp(`(^|[;{\\s])${property}\\s*:`, "m"),
      `\`subset.css\` declares no \`${property}\``,
    );
  }

  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const client: Client = new Client({
      post: (request) => {
        engine.submit(request, (response) => {
          client.receive(response);
        });
      },
    });
    const output = await client.preview([
      { op: "dialect", dialect: "obsidian" },
      styleOp([{ name: "subset.css", css }]),
      {
        op: "markdown",
        name: "chapter.md",
        text: "# Chapter One\n\nBody text, long enough to break over a line.\n",
      },
    ]);

    assert.ok(output, "the render was overtaken");
    assert.deepEqual(output.warnings, []);
  } finally {
    engine.free();
  }
});

test("every field is one key and one scalar, so the properties panel shows a line each", () => {
  const properties = writeDesign(whole());

  assert.deepEqual(Object.keys(properties), [...DESIGN_KEYS]);
  for (const [key, value] of Object.entries(properties)) {
    assert.ok(
      ["string", "number", "boolean"].includes(typeof value),
      `\`${key}\` is not a scalar`,
    );
  }
  assert.equal(properties["body-line-spacing"], "14pt");
  assert.equal(properties["trim"], "5.5in 8.5in");
  assert.equal(properties["heading-1-size"], "17pt");
});

test("one style key sets the weight and the slope of every place orca sets text", () => {
  const styled = DESIGN_KEYS.filter((key) => key.endsWith("-style"));

  assert.deepEqual(styled, [
    ...LEVELS.map((level) => `heading-${level}-style`),
    "chapter-drop-cap-style",
    "scene-break-style",
    "header-style",
    "folio-style",
  ]);
  for (const key of styled) {
    assert.deepEqual(propertiesOf(key), ["font-weight", "font-style"]);
  }
  // No other key sets either property, so one control settles both.
  for (const key of DESIGN_KEYS) {
    if (styled.includes(key)) continue;
    const properties = propertiesOf(key);
    assert.ok(!properties.includes("font-style"), `\`${key}\` sets a slope`);
    assert.ok(!properties.includes("font-weight"), `\`${key}\` sets a weight`);
  }
  // A style is one name, which is how the note writes it.
  assert.equal(readDesign({ "header-style": "bold-italic" }).headers.style, "bold-italic");
  assert.equal(writeDesign(readDesign({ "header-style": "Italic" }))["header-style"], "italic");
  assert.equal(readDesign({ "header-style": "oblique" }).headers.style, undefined);
  // A note that still carries these keys reads as a design that sets
  // nothing.
  assert.ok(!DESIGN_KEYS.includes("preset"));
  assert.deepEqual(
    readDesign({
      preset: "Quarto",
      "header-italic": true,
      "heading-1-weight": "bold",
      "heading-2-slope": "italic",
    }),
    emptyDesign(),
  );
});

test("a chapter's first line takes no style, because the pinned engine drops one there", () => {
  // The engine answers `Unsupported property font-style on
  // ::first-line`, so the first line waits on an engine that sets one.
  assert.ok(!DESIGN_KEYS.includes("chapter-first-line-style"));
  assert.deepEqual(readDesign({ "chapter-first-line-style": "italic" }), emptyDesign());
  assert.deepEqual(propertiesOf("chapter-first-line-caps"), [
    "font-variant-caps",
    "text-transform",
  ]);
});

test("a design read back from its own properties is the design that was written", () => {
  const design = whole();

  assert.deepEqual(readDesign(writeDesign(design)), design);
  assert.deepEqual(writeDesign(emptyDesign()), {});
  assert.deepEqual(readDesign({}), emptyDesign());
});

test("a heading level the design leaves alone writes no key of its own", () => {
  const design = emptyDesign();
  design.headings[2].align = "center";

  const properties = writeDesign(design);

  assert.deepEqual(properties, { "heading-2-align": "center" });
  // Every level the schema knows is readable, and each is its own set
  // of keys.
  assert.deepEqual(
    LEVELS.map((level) => `heading-${level}-font`).filter((key) =>
      DESIGN_KEYS.includes(key),
    ).length,
    6,
  );
});

test("a length written as a bare number is read in points, and junk is left unset", () => {
  const design = readDesign({
    "body-line-spacing": 14,
    "body-size": "10.5 PT",
    "body-first-line-indent": "1.2em",
    "body-orphans": "3",
    "body-hyphens": "yes",
    "body-align": "Justify",
    trim: "5.5in",
    "margin-inside": "0.95 furlongs",
    "margin-top": "-3pt",
    "margin-bottom": -3,
    "body-widows": -1,
    "chapter-drop-cap": "",
    "body-font": "   ",
  });

  assert.deepEqual(design.body.lineSpacing, { value: 14, unit: "pt" });
  assert.deepEqual(design.body.size, { value: 10.5, unit: "pt" });
  assert.deepEqual(design.body.indent, { value: 1.2, unit: "em" });
  assert.equal(design.body.orphans, 3);
  assert.equal(design.body.hyphens, true);
  assert.equal(design.body.align, "justify");
  // The schema leaves a field it cannot read to the layer under it. It
  // cannot read a negative length either.
  assert.equal(design.page.trim, undefined);
  assert.equal(design.page.margins.inside, undefined);
  assert.equal(design.page.margins.top, undefined);
  assert.equal(design.page.margins.bottom, undefined);
  assert.equal(design.body.widows, undefined);
  assert.equal(design.chapter.dropCap, undefined);
  assert.equal(design.body.font, undefined);
});

test("a value the panel cannot read throws a ValueError that says why", () => {
  assert.deepEqual(parseLength("12 pt"), { value: 12, unit: "pt" });
  assert.deepEqual(parseLength("12"), { value: 12, unit: "pt" });
  assert.deepEqual(parseLength(" 0.95IN "), { value: 0.95, unit: "in" });
  assert.deepEqual(parseLength(".5em"), { value: 0.5, unit: "em" });
  assert.equal(parseCount(" 3 "), 3);
  assert.equal(parseCount("0"), 0);

  const refused: [() => unknown, ValueError["kind"]][] = [
    [() => parseLength(""), "number"],
    [() => parseLength("twelve"), "number"],
    [() => parseLength("12 furlongs"), "unit"],
    [() => parseLength("-3pt"), "negative"],
    [() => parseCount("two"), "number"],
    [() => parseCount("3pt"), "number"],
    [() => parseCount("-1"), "negative"],
    [() => parseCount("2.5"), "whole"],
  ];
  for (const [read, kind] of refused) {
    assert.throws(
      read,
      (error) => error instanceof ValueError && error.kind === kind,
      `expected a \`${kind}\` error`,
    );
  }
});

test("a bare number is read in the unit handed in, and a written unit wins over it", () => {
  assert.deepEqual(parseLength("0.75", "in"), { value: 0.75, unit: "in" });
  assert.deepEqual(parseLength(" 19 ", "mm"), { value: 19, unit: "mm" });
  assert.deepEqual(parseLength("12pt", "in"), { value: 12, unit: "pt" });
  assert.deepEqual(parseLength("3"), { value: 3, unit: "pt" });
  assert.throws(
    () => parseLength("-1", "in"),
    (error) => error instanceof ValueError && error.kind === "negative",
  );
});

test("a length converts between the page units, to three places, and an em stays as it is", () => {
  assert.deepEqual(PAGE_UNITS, ["in", "mm", "pt"]);
  assert.deepEqual(convertLength(len(54, "pt"), "in"), len(0.75, "in"));
  assert.deepEqual(convertLength(len(0.75, "in"), "mm"), len(19.05, "mm"));
  assert.deepEqual(convertLength(len(0.6, "in"), "pt"), len(43.2, "pt"));
  assert.deepEqual(convertLength(len(10, "mm"), "in"), len(0.394, "in"));
  assert.deepEqual(convertLength({ value: 1, unit: "in" }, "pc"), { value: 6, unit: "pc" });
  assert.deepEqual(convertLength({ value: 2.54, unit: "cm" }, "mm"), len(25.4, "mm"));
  // An em is relative to a font size, so it has no length in inches.
  assert.deepEqual(convertLength(len(1.2, "em"), "pt"), len(1.2, "em"));
  assert.deepEqual(convertLength(len(12, "pt"), "em"), len(12, "pt"));
  // A margin converted to each page unit and back is unchanged.
  for (const unit of PAGE_UNITS) {
    const shown = convertLength(len(0.75, "in"), unit);
    assert.deepEqual(convertLength(shown, "in"), len(0.75, "in"), unit);
  }
});

test("a running head's position reads as outside or center, and nothing else", () => {
  assert.equal(readDesign({ "header-position": "Center" }).headers.position, "center");
  assert.equal(readDesign({ "header-position": "outside" }).headers.position, "outside");
  assert.equal(readDesign({ "header-position": "left" }).headers.position, undefined);
  // The key sits with the two slots it places, and with the heading
  // the chapter-title slot is read from.
  const at = DESIGN_KEYS.indexOf("header-left-page");
  assert.deepEqual(DESIGN_KEYS.slice(at, at + 4), [
    "header-left-page",
    "header-right-page",
    "chapter-title-from",
    "header-position",
  ]);
});

test("a step moves a length by its unit's step and a count by one, and stops at zero", () => {
  assert.deepEqual(STEPS, { pt: 0.5, pc: 0.5, in: 0.05, mm: 1, cm: 0.1, em: 0.1 });
  for (const unit of UNITS) {
    // Seven steps up, one at a time, land on seven steps with no float
    // noise, and eight steps down stop at zero.
    let length: Length = { value: 0, unit };
    for (let at = 0; at < 7; at += 1) length = stepLength(length, 1);
    assert.equal(length.value, Number((7 * STEPS[unit]).toFixed(4)), unit);
    assert.deepEqual(stepLength(length, -1, 8), { value: 0, unit });
  }
  assert.deepEqual(stepLength({ value: 0.95, unit: "in" }, 1), { value: 1, unit: "in" });
  assert.deepEqual(stepLength({ value: 1.2, unit: "em" }, 1, 3), { value: 1.5, unit: "em" });
  assert.deepEqual(stepLength({ value: 0.3, unit: "pt" }, -1), { value: 0, unit: "pt" });

  assert.equal(stepCount(2, 1), 3);
  assert.equal(stepCount(2, 1, 10), 12);
  assert.equal(stepCount(0, -1), 0);
  assert.equal(stepCount(2, -1, 5), 0);
});

test("a book's own keys win over the design under it, field by field", () => {
  const under = readDesign({
    "body-font": "EB Garamond",
    "body-line-spacing": 14,
    "body-orphans": 3,
    "heading-1-size": "17pt",
    "heading-1-align": "center",
  });
  const over = readDesign({
    "body-line-spacing": "15pt",
    "heading-1-align": "left",
  });

  const merged = mergeDesign(under, over);

  assert.equal(merged.body.font, "EB Garamond");
  assert.deepEqual(merged.body.lineSpacing, { value: 15, unit: "pt" });
  assert.equal(merged.body.orphans, 3);
  // A level is merged field by field rather than replaced whole.
  assert.deepEqual(merged.headings[1], {
    size: { value: 17, unit: "pt" },
    align: "left",
  });
  // Merging leaves both designs as they were.
  assert.deepEqual(over, readDesign({
    "body-line-spacing": "15pt",
    "heading-1-align": "left",
  }));
});

test("every trim the panel offers survives a trip through the note", () => {
  for (const { name, trim } of BOOK_SIZES) {
    const design = emptyDesign();
    design.page.trim = trim;

    const read = readDesign(writeDesign(design));

    assert.deepEqual(read.page.trim, trim, `\`${name}\` did not come back`);
  }
});

function whole(): Design {
  const design: Design = {
    page: {
      trim: { width: len(5.5, "in"), height: len(8.5, "in") },
      margins: {
        inside: len(0.95, "in"),
        outside: len(0.7, "in"),
        top: len(0.8, "in"),
        bottom: len(1, "in"),
      },
    },
    body: {
      font: "Alegreya",
      fontVariant: "SC",
      size: len(10.5, "pt"),
      lineSpacing: len(14, "pt"),
      align: "justify",
      indent: len(1.2, "em"),
      indentAfterBreak: false,
      hyphens: true,
      hangingPunctuation: false,
      orphans: 2,
      widows: 2,
      keepHeadings: true,
    },
    headings: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} },
    chapter: {
      begins: "right-page",
      dropCap: 3,
      dropCapFont: "Junicode",
      dropCapStyle: "bold",
      firstLineCaps: "all-caps",
      firstLineLetterSpacing: len(0.04, "em"),
    },
    scene: {
      mark: "ornament",
      ornament: "⁂",
      font: "Junicode",
      style: "bold-italic",
      size: len(9.5, "pt"),
      spaceAbove: 1,
      spaceBelow: 1,
    },
    headers: {
      leftPage: "author",
      rightPage: "book-title",
      chapterTitle: "h2",
      position: "center",
      pageNumber: "bottom",
      pageNumberFormat: "arabic",
      font: "Junicode",
      folioFont: "Alegreya",
      style: "italic",
      folioStyle: "normal",
      caps: "small-caps",
      letterSpacing: len(0.06, "em"),
      suppressOnOpenings: true,
    },
  };
  for (const level of LEVELS) {
    design.headings[level] = {
      font: "EB Garamond",
      fontVariant: "Semibold",
      style: "italic",
      size: len(18 - level, "pt"),
      caps: "small-caps",
      letterSpacing: len(0.08, "em"),
      align: "center",
      spaceAbove: 7,
      spaceBelow: 2,
    };
  }
  return design;
}

function len(value: number, unit: "in" | "pt" | "em" | "mm") {
  return { value, unit };
}

async function subset(): Promise<string> {
  return readFile(path.join(root, "src/style/subset.css"), "utf8");
}

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

test("a design names the body font, each heading level's font and the drop cap's, each family once", () => {
  const design = emptyDesign();
  assert.deepEqual(designFonts(design), []);
  design.body.font = "Alegreya";
  design.headings[1].font = "Spectral";
  design.headings[2].font = "alegreya";
  design.headings[4].font = "Charter";
  design.chapter.dropCapFont = "Junicode";
  assert.deepEqual(designFonts(design), ["Alegreya", "Spectral", "Charter", "Junicode"]);
  // The drop cap registers a face like any other place a font is set.
  assert.deepEqual(designUses(design).at(-1), { font: "Junicode", variant: undefined });
});

test("a font's variant is written right after its font, and sets no CSS of its own", () => {
  assert.equal(DESIGN_KEYS[DESIGN_KEYS.indexOf("body-font") + 1], "body-font-variant");
  for (const level of LEVELS) {
    const at = DESIGN_KEYS.indexOf(`heading-${level}-font`);
    assert.equal(DESIGN_KEYS[at + 1], `heading-${level}-font-variant`);
  }
  // The default variant is stored as absent, so a blank one is unset.
  assert.equal(readDesign({ "body-font-variant": "  " }).body.fontVariant, undefined);
  assert.deepEqual(writeDesign(emptyDesign()), {});
});

test("a variant survives a trip through the properties and through the note, byte for byte", () => {
  const pieces = ["Cond", "SmCond", "Semi Bold", 'Quote "It"', "Back\\slash", "a: b", "- dash", "#tag", "Kursiv ü", "字体", "'single'", "[list]", "{map}", "yes", "123"];
  let seed = 113;
  const next = (below: number) => {
    // A linear congruential step, so a failure replays the same case.
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % below;
  };
  const pick = () => pieces[next(pieces.length)] ?? "Cond";

  for (let round = 0; round < 200; round += 1) {
    const design = emptyDesign();
    design.body.font = "Junicode";
    design.body.fontVariant = next(2) === 0 ? pick() : `${pick()} ${pick()}`;
    for (const level of LEVELS) {
      if (next(3) === 0) continue;
      design.headings[level].font = "Junicode";
      if (next(2) === 0) design.headings[level].fontVariant = pick();
    }

    assert.deepEqual(readDesign(writeDesign(design)), design);
    const text = writeNote({ format: FORMAT, metadata: {}, fonts: [], design, own: {} }, "\n");
    const { properties, body } = readFrontmatter(text);
    assert.equal(writeNote(readBook(properties), body), text);
    assert.deepEqual(readBook(properties).design, design);
  }
});

test("a design sets each font and variant once, and a level with no font takes the body's pair", () => {
  const design = emptyDesign();
  assert.deepEqual(designUses(design), []);
  design.body.font = "Junicode";
  design.headings[1].font = "Junicode";
  design.headings[1].fontVariant = "Cond";

  assert.deepEqual(designUses(design), [
    { font: "Junicode", variant: undefined },
    { font: "Junicode", variant: "Cond" },
  ]);

  design.body.fontVariant = "SmCond";
  design.headings[2].font = "junicode";
  design.headings[2].fontVariant = "cond";
  design.headings[3].font = "Junicode";
  design.headings[4].fontVariant = "Light";
  assert.deepEqual(designUses(design), [
    { font: "Junicode", variant: "SmCond" },
    { font: "Junicode", variant: "Cond" },
    { font: "Junicode", variant: undefined },
  ]);
});

test("body text takes all four alignments, and a heading takes every one but justify", () => {
  for (const align of ["left", "center", "right", "justify"]) {
    const written = writeDesign(readDesign({ "body-align": align }));
    assert.equal(written["body-align"], align);
  }
  for (const align of ["left", "center", "right"]) {
    const written = writeDesign(readDesign({ "heading-2-align": align }));
    assert.equal(written["heading-2-align"], align);
  }
  // The schema does not read justify at a heading, so the key is left
  // to the layer under it.
  const justified = writeDesign(readDesign({ "heading-2-align": "justify" }));
  assert.equal(justified["heading-2-align"], undefined);
});

// What this tier does not cover: the declarations a design turns into,
// which belong to the generated layer. The theme's tier covers the
// defaults a book that sets nothing gets. The words the panel shows for
// each kind of `ValueError` belong to `ui`.
