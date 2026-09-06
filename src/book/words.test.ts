import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { countWords } from "@/book/words";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

test("a word count comes from the note's body, and its properties are not words", async () => {
  const chapter = await readText(vault, "Chapter Twelve.md");

  assert.equal(countWords(chapter), 186);
  // The frontmatter names the book and its author, and neither is in
  // the chapter.
  assert.equal(
    countWords(chapter),
    countWords(chapter.replace(/^---\n[\s\S]*?\n---\n/, "")),
  );
  assert.equal(countWords(""), 0);
  assert.equal(countWords("---\ntitle: Empty\n---\n"), 0);
});

test("a hyphen or an apostrophe joins a word, and a dash or a mark does not", () => {
  assert.equal(countWords("well-bred, Mr. Bingley's carriage"), 4);
  assert.equal(countWords("resolved—nor did she"), 4);
  assert.equal(countWords("# Chapter Twelve\n\n- [[Copyright]] `copyright`"), 4);
  assert.equal(countWords("1813 was the year"), 4);
});

// What this tier does not cover: a note read through Obsidian's vault,
// which the e2e suite counts on the book page.
