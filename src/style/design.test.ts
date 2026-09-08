import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Client, createEngine, styleOp, type Op } from "fleuron";
import { DESIGN_SHEET, designSheet, designSheets } from "@/style/design";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";

test("the sheet names the family a design chose, under the design's own name", () => {
  const sheet = designSheet({ face: "EB Garamond" });

  assert.equal(sheet.name, DESIGN_SHEET);
  assert.ok(sheet.css.includes('book { font-family: "EB Garamond", serif; }'));
  assert.deepEqual(
    designSheets({ face: "EB Garamond" }).map((each) => each.name),
    [THEME_SHEET, DESIGN_SHEET],
  );
});

test("a design with no face generates nothing that overrides the theme", () => {
  const sheets = designSheets({});

  assert.equal(designSheet({}).css, "");
  assert.deepEqual(sheets[0], { name: THEME_SHEET, css: BUNDLED_THEME });
  assert.equal(sheets[1]?.css, "");
});

test("a family name with a quote in it is escaped rather than left to close the string", () => {
  const css = designSheet({ face: 'Ba"d\\Face' }).css;

  // The name is read off a font file's own table, so a quote in it
  // closes nothing: the declaration is still one string.
  assert.ok(css.includes('font-family: "Ba\\"d\\\\Face", serif;'));
  assert.equal(css.split('"').length - 1, 3);
});

test("a book set in a family the engine does not have still sets, and warns about none of it", async () => {
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const client: Client = new Client({
      post: (request) => {
        engine.submit(request, (response) => {
          client.receive(response);
        });
      },
    });
    const ops: Op[] = [
      { op: "dialect", dialect: "obsidian" },
      styleOp(designSheets({ face: "Nonesuch" })),
      {
        op: "markdown",
        name: "chapter.md",
        text: "# Chapter One\n\nBody text set from a face the engine has not got.\n",
      },
    ];
    const output = await client.preview(ops);

    assert.ok(output, "the render was overtaken");
    // The engine falls back to the face it carries and says nothing, so
    // naming a family the author has not got is orca's own to report.
    assert.deepEqual(output.warnings, []);
    assert.ok(output.pages.length > 0);
    assert.deepEqual([...new Set(output.fonts.map((font) => font.family))], [
      "eb garamond",
    ]);
  } finally {
    engine.free();
  }
});

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: a design that sets anything but a
// face, which waits on the settings model, and the warning orca raises
// for a family the vault has not got, which the picker owns.
