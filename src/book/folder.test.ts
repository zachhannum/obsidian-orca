import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { readFrontmatter } from "@/book/frontmatter";
import { chapterFolder, folderOf, loose } from "@/book/folder";
import { pathLinks } from "@/book/links";
import { readOrder, resolve } from "@/book/order";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

test("the notes in a book's folder that are not in it are named, and the folder is the book's own", async () => {
  const order = readOrder(readFrontmatter(await readText(vault, BOOK)).body);
  const paths = (await vault.list("/")).files;

  const here = resolve(order, pathLinks(paths), BOOK).sections;
  assert.equal(chapterFolder(here, BOOK), "");
  // Every note in the fixture's folder is in the book, and the book
  // note is not one of its own loose notes.
  assert.deepEqual(loose("", paths, here, BOOK), []);
  assert.deepEqual(loose("", [...paths, "Scraps.md"], here, BOOK), ["Scraps.md"]);

  // The folder is where the chapters are, so moving them moves it.
  const moved = paths.map((at) =>
    at.startsWith("Chapter") ? `Manuscript/Chapters/${at}` : at,
  );
  const away = resolve(order, pathLinks(moved), BOOK).sections;
  assert.equal(chapterFolder(away, BOOK), "Manuscript/Chapters");
  assert.deepEqual(
    loose("Manuscript/Chapters", [...moved, "Manuscript/Chapters/Chapter Nine.md"], away, BOOK),
    ["Manuscript/Chapters/Chapter Nine.md"],
  );
  assert.equal(folderOf(BOOK), "");
});

// What this tier does not cover: the quiet line the navigator draws
// from this, which the e2e suite opens on a note the book does not
// read.
