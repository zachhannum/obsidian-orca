import assert from "node:assert/strict";
import { test } from "node:test";
import { fileName, free } from "@/ui/naming";

/** A folder holding these paths. */
function holding(...paths: string[]): (path: string) => boolean {
  const held = new Set(paths);
  return (path) => held.has(path);
}

test("a title another note in the folder uses gives the next free name", () => {
  const taken = holding("Books/Emma.md", "Books/Emma 1.md", "Emma 2.md");

  assert.equal(free("Books", "Emma", taken), "Books/Emma 2.md");
  assert.equal(free("", "Emma", taken), "Emma.md");
});

test("the note being named keeps its own path when that is the first free one", () => {
  const taken = holding("Emma.md", "Emma 1.md");

  assert.equal(free("", "Emma", taken, "Emma 1.md"), "Emma 1.md");
  assert.equal(free("", "Emma", taken, "Emma.md"), "Emma.md");
});

test("a title with characters a file name cannot hold gives a name without them", () => {
  assert.equal(fileName('Who? What: "Why" <How> a/b\\c * | #1 ^x [y]'), "Who What Why How abc 1 x y");
  assert.equal(fileName("..Hidden"), "Hidden");
  assert.equal(fileName("  Pride   and Prejudice  "), "Pride and Prejudice");
});

test("a title with nothing fit for a file name gives no name", () => {
  assert.equal(fileName("?:*"), "");
  assert.equal(fileName(""), "");
});

// What this tier does not cover: the rename itself and the links that
// follow it, which Obsidian's file manager does and the e2e suite reads.
