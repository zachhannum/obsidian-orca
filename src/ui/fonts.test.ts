import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { vaultFonts } from "@/ui/fonts";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The face the fixture vault carries. */
const FACE = "fonts/Alegreya-VariableFont_wght.ttf";

test("a face still reads whole after an earlier read crossed to the worker", async () => {
  const fonts = vaultFonts(vault);
  const crossing = await fonts.whole(FACE);
  assert.ok(crossing.byteLength > 0);

  // The op that carries a face transfers its buffer, which detaches it.
  structuredClone(crossing.buffer, { transfer: [crossing.buffer] });
  assert.equal(crossing.byteLength, 0);

  const again = await fonts.whole(FACE);
  assert.ok(again.byteLength > 0);
  // The index reads ranges out of the same held file.
  assert.deepEqual(await fonts.read(FACE, 0, 4), again.subarray(0, 4));
});

// What this tier does not cover: the platform's own font directories,
// which are the machine's rather than the fixture's, and the picker
// rows a face is registered for, which need a document.
