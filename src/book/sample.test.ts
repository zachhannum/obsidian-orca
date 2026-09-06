import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { styleOp } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { SAMPLE, openBook } from "@/book/sample";
import { THEME_SHEET } from "@/style/theme";

const root = process.env["ORCA_ROOT"] ?? process.cwd();

test("the sample note crosses as the whole book, in Obsidian's markdown, with no style of its own", () => {
  assert.deepEqual(openBook(SAMPLE), [
    { op: "dialect", dialect: "obsidian" },
    { op: "markdown", name: SAMPLE.name, text: SAMPLE.text },
    styleOp([{ name: THEME_SHEET, css: "" }]),
  ]);
});

test("the note's frontmatter names the book's title and author", () => {
  assert.match(SAMPLE.text, /^---\ntitle: Pride and Prejudice\nauthor: Jane Austen\n---\n/);
});

test("the note that ships with the plugin is the note in the fixture vault", async () => {
  const vault = directoryVault(path.join(root, "fixture"));

  assert.equal(await readText(vault, SAMPLE.name), SAMPLE.text);
});

// What this tier does not cover: a book of several notes crossing as
// one op, which waits on the theme it is set in.
