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
  assert.equal(properties["leading"], "14pt");
  assert.equal(properties["trim"], "5.5in 8.5in");
});

test("a design read back from its own properties is the design that was written", () => {
  const design = whole();

  assert.deepEqual(readDesign(writeDesign(design)), design);
  assert.deepEqual(writeDesign(emptyDesign()), {});
  assert.deepEqual(readDesign({}), emptyDesign());
});

test("a length written as a bare number is read in points, and junk is left unset", () => {
  const design = readDesign({
    leading: 14,
    size: "10.5 PT",
    indent: "1.2em",
    orphans: "3",
    hyphens: "yes",
    align: "Justify",
    trim: "5.5in",
    "margin-inner": "0.95 furlongs",
    widows: -1,
    face: "   ",
  });

  assert.deepEqual(design.text.leading, { value: 14, unit: "pt" });
  assert.deepEqual(design.text.size, { value: 10.5, unit: "pt" });
  assert.deepEqual(design.text.indent, { value: 1.2, unit: "em" });
  assert.equal(design.breaks.orphans, 3);
  assert.equal(design.text.hyphens, true);
  assert.equal(design.text.align, "justify");
  // A field the schema cannot read is left to the layer under it.
  assert.equal(design.page.trim, undefined);
  assert.equal(design.page.margins.inner, undefined);
  assert.equal(design.breaks.widows, undefined);
  assert.equal(design.text.face, undefined);
});

test("a book's own keys win over the design note it points at, field by field", () => {
  const shared = readDesign({ face: "EB Garamond", leading: 14, orphans: 3 });
  const own = readDesign({ leading: "15pt" });

  const merged = mergeDesign(shared, own);

  assert.equal(merged.text.face, "EB Garamond");
  assert.deepEqual(merged.text.leading, { value: 15, unit: "pt" });
  assert.equal(merged.breaks.orphans, 3);
  // Merging leaves both designs as they were.
  assert.deepEqual(own, readDesign({ leading: "15pt" }));
});

function whole(): Design {
  return {
    page: {
      trim: { width: len(5.5, "in"), height: len(8.5, "in") },
      margins: {
        inner: len(0.95, "in"),
        outer: len(0.7, "in"),
        top: len(0.8, "in"),
        bottom: len(1, "in"),
      },
      mirrored: true,
    },
    text: {
      face: "Alegreya",
      size: len(10.5, "pt"),
      leading: len(14, "pt"),
      align: "justify",
      indent: len(1.2, "em"),
      hyphens: true,
      hanging: false,
    },
    breaks: { orphans: 2, widows: 2 },
    chapter: {
      opensOn: "recto",
      sink: 7,
      heading: {
        face: "EB Garamond",
        size: len(17, "pt"),
        weight: "regular",
        slope: "roman",
        align: "center",
      },
      dropCap: 3,
    },
    scene: { ornament: "⁂" },
    running: { verso: "author", recto: "book", folio: "foot", numerals: "arabic" },
  };
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
