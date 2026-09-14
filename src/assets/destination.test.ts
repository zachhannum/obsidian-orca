import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { vaultWritePath } from "@/assets/destination";
import { directorySink } from "@/assets/directory";
import { AssetError } from "@/assets/errors";

async function scratch(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "orca-destination-"));
}

test("a vault destination writes exactly the bytes to its file", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);

  await directorySink(root).write(
    { kind: "vault", path: "Exports/./Pride and Prejudice.pdf" },
    bytes,
  );

  const written = await readFile(
    path.join(root, "Exports", "Pride and Prejudice.pdf"),
  );
  assert.deepEqual(new Uint8Array(written), bytes);
});

test("a disk destination writes at its absolute path", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = new Uint8Array([1, 2, 3]);
  const at = path.join(root, "out", "book.pdf");

  await directorySink(path.join(root, "vault")).write(
    { kind: "disk", path: at },
    bytes,
  );

  assert.deepEqual(new Uint8Array(await readFile(at)), bytes);
});

test("a vault path is normalized before it is written", () => {
  assert.equal(vaultWritePath("Exports//book.pdf/"), "Exports/book.pdf");
  assert.equal(vaultWritePath("Exports\\book.pdf"), "Exports/book.pdf");
});

test("a bad vault path is refused with an asset error", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sink = directorySink(root);
  const bytes = new Uint8Array([1]);

  const refused = [
    "",
    "  ",
    ".",
    "/book.pdf",
    "C:/book.pdf",
    "../book.pdf",
    "Exports/../../book.pdf",
  ];
  for (const bad of refused) {
    assert.throws(() => vaultWritePath(bad), AssetError, bad);
    await assert.rejects(
      sink.write({ kind: "vault", path: bad }, bytes),
      AssetError,
      bad,
    );
  }
});

// What this file does not cover: the sink over Obsidian's vault and the
// native save dialog, which live in `ui`, and a write the file system
// refuses for want of permission or space.
