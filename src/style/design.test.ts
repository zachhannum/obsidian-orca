import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Client, createEngine, styleOp } from "fleuron";
import {
  DESIGN_KEYS,
  DESIGN_PROPERTIES,
  LEVELS,
  emptyDesign,
  mergeDesign,
  readDesign,
  writeDesign,
  type Design,
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

test("a design read back from its own properties is the design that was written", () => {
  const design = whole();

  assert.deepEqual(readDesign(writeDesign(design)), design);
  assert.deepEqual(writeDesign(emptyDesign()), {});
  assert.deepEqual(readDesign({}), emptyDesign());
});

test("a heading level the design leaves alone writes no key of its own", () => {
  const design = emptyDesign();
  design.headings[2].weight = "bold";

  const properties = writeDesign(design);

  assert.deepEqual(properties, { "heading-2-weight": "bold" });
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
    "body-widows": -1,
    "body-font": "   ",
  });

  assert.deepEqual(design.body.lineSpacing, { value: 14, unit: "pt" });
  assert.deepEqual(design.body.size, { value: 10.5, unit: "pt" });
  assert.deepEqual(design.body.indent, { value: 1.2, unit: "em" });
  assert.equal(design.body.orphans, 3);
  assert.equal(design.body.hyphens, true);
  assert.equal(design.body.align, "justify");
  // A field the schema cannot read is left to the layer under it.
  assert.equal(design.page.trim, undefined);
  assert.equal(design.page.margins.inside, undefined);
  assert.equal(design.body.widows, undefined);
  assert.equal(design.body.font, undefined);
});

test("a book's own keys win over the design under it, field by field", () => {
  const under = readDesign({
    "body-font": "EB Garamond",
    "body-line-spacing": 14,
    "body-orphans": 3,
    "heading-1-size": "17pt",
    "heading-1-weight": "bold",
  });
  const over = readDesign({
    "body-line-spacing": "15pt",
    "heading-1-weight": "regular",
  });

  const merged = mergeDesign(under, over);

  assert.equal(merged.body.font, "EB Garamond");
  assert.deepEqual(merged.body.lineSpacing, { value: 15, unit: "pt" });
  assert.equal(merged.body.orphans, 3);
  // A level is merged field by field rather than replaced whole.
  assert.deepEqual(merged.headings[1], {
    size: { value: 17, unit: "pt" },
    weight: "regular",
  });
  // Merging leaves both designs as they were.
  assert.deepEqual(over, readDesign({
    "body-line-spacing": "15pt",
    "heading-1-weight": "regular",
  }));
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
      hyphens: true,
      hangingPunctuation: false,
      orphans: 2,
      widows: 2,
    },
    headings: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} },
    chapter: { begins: "right-page", spaceAbove: 7, dropCap: 3 },
    scene: { ornament: "\u2042" },
    headers: {
      leftPage: "author",
      rightPage: "book-title",
      pageNumber: "bottom",
      pageNumberFormat: "arabic",
    },
  };
  for (const level of LEVELS) {
    design.headings[level] = {
      font: "EB Garamond",
      size: len(18 - level, "pt"),
      weight: "regular",
      align: "center",
    };
  }
  return design;
}

function len(value: number, unit: "in" | "pt" | "em") {
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
// which belong to the generated layer, and the values a preset opens a
// book on.
