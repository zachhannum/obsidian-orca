import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, type Model } from "@/book/model";
import { membership } from "@/ui/member";
import type { Opened } from "@/ui/shelf";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

const BOOK = "Pride and Prejudice.md";
const SECOND = "The Bennet Novels.md";

async function model(): Promise<Model> {
  return readModel(await readText(vault, BOOK));
}

async function links(): Promise<ReturnType<typeof pathLinks>> {
  const paths = (await vault.list("/")).files;
  return pathLinks([...paths, SECOND]);
}

async function book(): Promise<Opened> {
  return { path: BOOK, name: "Pride and Prejudice", model: await model() };
}

test("a note the book reads belongs to it, at the place the order gives it", async () => {
  const found = membership([await book()], await links());

  // The fixture opens on a generated title page, so the first note the
  // order names is not the first entry in it.
  assert.deepEqual(found.get("Chapter Twelve.md"), { book: BOOK, at: 5 });
  assert.deepEqual(found.get("Copyright.md"), { book: BOOK, at: 1 });

  // The book note is not one of its own sections, and an entry whose
  // note the vault does not have never resolved to a path.
  assert.equal(found.get(BOOK), undefined);
  assert.equal(found.get("Chapter Four.md"), undefined);
});

test("a note two books read belongs to the first of them", async () => {
  const second: Opened = {
    path: SECOND,
    name: "The Bennet Novels",
    model: readModel(
      "---\norca-book: 1\n---\n\n# Body\n\n- [[Chapter Twelve]]\n",
    ),
  };

  const found = membership([second, await book()], await links());

  assert.deepEqual(found.get("Chapter Twelve.md"), { book: SECOND, at: 0 });
});

// What this tier does not cover: the index being rebuilt as the vault
// changes, which is the plugin's, and the e2e suite's.
