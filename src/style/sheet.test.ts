import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Client, createEngine, styleOp, type Op, type Sheet } from "fleuron";
import { emptyDesign, type Design } from "@/style/design";
import { DESIGN_SHEET, OWN_SHEET, designSheet, designSheets } from "@/style/sheet";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";

/** A book of one chapter, which the sheets set. */
const CHAPTER: Op = {
  op: "markdown",
  name: "chapter.md",
  text: "# Chapter One\n\nBody text, long enough to break over a line.\n",
};

const SETTING = { roles: ["chapter"] } as const;

test("the three layers cross in one order, and the last one to set a size wins", async () => {
  const sheets = designSheets(sized(20), SETTING, "book { font-size: 30pt; }");

  assert.deepEqual(sheets.map((sheet) => sheet.name), [
    THEME_SHEET,
    DESIGN_SHEET,
    OWN_SHEET,
  ]);
  // The theme sets 11pt, the design 20pt and the author 30pt, so each
  // layer beats the one sent before it.
  assert.equal(await bodySize(sheets), 30);
  assert.equal(await bodySize(designSheets(sized(20), SETTING)), 20);
  assert.equal(await bodySize(designSheets(emptyDesign(), SETTING)), 11);
});

test("a design that settles nothing generates nothing but the page names", () => {
  const sheets = designSheets(emptyDesign(), SETTING);

  // The page names come from the reading order rather than from the
  // design, so a book with no design still has them.
  assert.equal(
    designSheet(emptyDesign(), SETTING).css,
    "section:nth-child(1) {\n  page: chapter;\n}\n",
  );
  assert.equal(designSheet(emptyDesign(), { roles: [] }).css, "");
  assert.deepEqual(sheets[0], { name: THEME_SHEET, css: BUNDLED_THEME });
  assert.equal(sheets[2]?.css, "");
});

test("a book set in a font the engine does not have still sets, and warns about none of it", async () => {
  const design = emptyDesign();
  design.body.font = "Nonesuch";
  const output = await set(designSheets(design, SETTING));

  // The engine falls back to the font it carries without a warning,
  // so a font the author does not have is orca's to report.
  assert.deepEqual(output.warnings, []);
  assert.ok(output.pages.length > 0);
  assert.deepEqual([...new Set(output.fonts.map((font) => font.family))], [
    "eb garamond",
  ]);
});

function sized(points: number): Design {
  const design = emptyDesign();
  design.body.size = { value: points, unit: "pt" };
  return design;
}

/** The size the chapter's body text is set in. */
async function bodySize(sheets: Sheet[]): Promise<number | undefined> {
  const output = await set(sheets);
  const found = output.pages.flatMap((page) =>
    page.items.flatMap((item) =>
      item.kind === "text" && item.text.startsWith("Body") ? [item.size] : [],
    ),
  );
  return found[0];
}

async function set(sheets: Sheet[]) {
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
      styleOp(sheets),
      CHAPTER,
    ]);
    assert.ok(output, "the render was overtaken");
    return output;
  } finally {
    engine.free();
  }
}

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: the author's own layer with anything
// in it, which waits on the note's css fence.
