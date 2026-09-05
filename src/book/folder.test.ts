import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { readFrontmatter } from "@/book/frontmatter";
import { chapterFolder, folderOf } from "@/book/folder";
import { pathLinks } from "@/book/links";
import { readOrder, resolve } from "@/book/order";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

test("a book's folder is where most of its chapters are", async () => {
  const order = readOrder(readFrontmatter(await readText(vault, BOOK)).body);
  const paths = (await vault.list("/")).files;

  const here = resolve(order, pathLinks(paths), BOOK).sections;
  assert.equal(chapterFolder(here, BOOK), "");

  // The folder is where the chapters are, so moving them moves it.
  const moved = paths.map((at) =>
    at.startsWith("Chapter") ? `Manuscript/Chapters/${at}` : at,
  );
  const away = resolve(order, pathLinks(moved), BOOK).sections;
  assert.equal(chapterFolder(away, BOOK), "Manuscript/Chapters");
  assert.equal(folderOf(BOOK), "");
});

// What this tier does not cover: a book whose chapters are spread
// evenly over two folders, where the folder the count settles on is
// arbitrary.
