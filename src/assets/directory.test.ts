import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { AssetError } from "@/assets/errors";
import { readBytes, readText } from "@/assets/vault";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

test("the fixture directory is a vault every read goes through", async () => {
  assert.deepEqual(await vault.list("/"), {
    files: ["Chapter Twelve.md", "Pride and Prejudice.md"],
    folders: [],
  });
  assert.equal(await vault.exists("Chapter Twelve.md"), true);
  assert.equal(await vault.exists("Chapter Thirteen.md"), false);

  const note = await readText(vault, "Chapter Twelve.md");
  assert.match(note, /^---\ntitle: Pride and Prejudice\n/);
  assert.equal(
    (await readBytes(vault, "Chapter Twelve.md")).byteLength,
    new TextEncoder().encode(note).byteLength,
  );
});

test("a missing file is an asset error naming the path", async () => {
  await assert.rejects(
    readText(vault, "Chapter Thirteen.md"),
    (error: unknown) =>
      error instanceof AssetError &&
      error.message.includes("Chapter Thirteen.md"),
  );
});

test("a path that leads outside the directory is refused", async () => {
  await assert.rejects(
    readText(vault, "../package.json"),
    (error: unknown) =>
      error instanceof AssetError &&
      error.message.includes("outside the vault"),
  );
});

// What this tier does not cover: the adapter over Obsidian's own vault,
// which the e2e job reaches, and the font index, the content-hash
// registry and image resolution, which are not written yet.
