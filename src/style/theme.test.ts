import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Client, createEngine, type Op } from "fleuron";
import { BUNDLED_THEME } from "@/style/theme";

test("the bundled theme sets one face in two sizes, with nothing the engine warns about", async () => {
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
      { op: "style", css: BUNDLED_THEME },
      {
        op: "markdown",
        name: "chapter.md",
        text: "# Chapter One\n\nBody text set from the theme.\n",
      },
    ];
    const output = await client.preview(ops);
    assert.ok(output, "the render was overtaken");
    assert.deepEqual(output.warnings, []);

    const sizes = output.pages.flatMap((page) =>
      page.items.flatMap((item) => (item.kind === "text" ? [item.size] : [])),
    );
    assert.deepEqual([...new Set(sizes)].sort((a, b) => a - b), [11, 19]);

    const faces = new Set(output.fonts.map((font) => font.family));
    assert.deepEqual([...faces], ["eb garamond"]);
  } finally {
    engine.free();
  }
});

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: a stylesheet the design panel
// generates from settings, which waits on the settings model.
