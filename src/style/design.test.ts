import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Client, createEngine, styleOp } from "fleuron";
import {
  BOOK_SIZES,
  DESIGN_KEYS,
  DESIGN_PROPERTIES,
  LEVELS,
  STEPS,
  UNITS,
  ValueError,
  emptyDesign,
  mergeDesign,
  parseCount,
  parseLength,
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

test("the schema has no preset and no heading weight or slope", () => {
  for (const key of DESIGN_KEYS) {
    assert.ok(!/-(weight|slope)$/.test(key), `\`${key}\` is still in the schema`);
  }
  assert.ok(!DESIGN_KEYS.includes("preset"));
  assert.ok(!DESIGN_PROPERTIES.includes("font-weight"));
  assert.ok(!DESIGN_PROPERTIES.includes("font-style"));
  // A note that still carries these keys reads as a design that sets
  // nothing.
  assert.deepEqual(
    readDesign({
      preset: "Quarto",
      "heading-1-weight": "bold",
      "heading-2-slope": "italic",
    }),
    emptyDesign(),
  );
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
  // A field the schema cannot read is left to the layer under it. A
  // negative length is one of these.
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
      mirrored: true,
    },
    body: {
      font: "Alegreya",
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
      spaceAbove: 7,
      spaceBelow: 2,
      dropCap: 3,
    },
    scene: {
      mark: "ornament",
      ornament: "⁂",
      word: "Later",
      spaceAbove: 1,
      spaceBelow: 1,
    },
    headers: {
      leftPage: "author",
      rightPage: "book-title",
      pageNumber: "bottom",
      pageNumberFormat: "arabic",
      suppressOnOpenings: true,
    },
  };
  for (const level of LEVELS) {
    design.headings[level] = {
      font: "EB Garamond",
      size: len(18 - level, "pt"),
      align: "center",
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

// What this tier does not cover: the declarations a design turns into,
// which belong to the generated layer, the defaults a book that sets
// nothing gets, which the theme's tier covers, and the words the panel
// shows for each kind of `ValueError`, which belong to `ui`.
