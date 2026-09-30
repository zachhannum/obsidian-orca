import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { engineModule } from "@/engine/module";

const require = createRequire(import.meta.url);

test("the bundle carries the engine module byte for byte", async () => {
  const shipped = await readFile(require.resolve("fleuron/fleuron_bg.wasm"));
  assert.ok(Buffer.from(engineModule()).equals(shipped));
});

test("the module is decoded once", () => {
  assert.equal(engineModule(), engineModule());
});

// What this tier does not cover: how long the decode takes inside
// Obsidian, which the e2e job reaches only as a book that opens.
