import assert from "node:assert/strict";
import { test } from "node:test";
import { readModule } from "@/engine/module";
import { EngineError } from "@/engine/errors";

const INSTALL = ".obsidian/plugins/orca";
const MODULE = `${INSTALL}/fleuron_bg.wasm`;

test("the module is read from the plugin's own install path", async () => {
  const asked: string[] = [];
  const bytes = new ArrayBuffer(4);
  const read = await readModule(
    {
      readBinary: async (path) => {
        asked.push(path);
        return bytes;
      },
    },
    INSTALL,
  );

  assert.deepEqual(asked, [MODULE]);
  assert.equal(read, bytes);
});

test("a missing module is an engine error naming where it looked", async () => {
  await assert.rejects(
    readModule({ readBinary: () => Promise.reject(new Error("ENOENT")) }, INSTALL),
    (error: unknown) =>
      error instanceof EngineError && error.message.includes(MODULE),
  );
});
