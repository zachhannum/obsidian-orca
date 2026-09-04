import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLE, openBook } from "@/book/sample";

test("the sample note crosses as the whole book, in Obsidian's markdown", () => {
  assert.deepEqual(openBook(SAMPLE), [
    { op: "dialect", dialect: "obsidian" },
    { op: "markdown", name: SAMPLE.name, text: SAMPLE.text },
  ]);
});

test("the note names the book, since a book of one file has no other way", () => {
  assert.match(SAMPLE.text, /^---\ntitle: Pride and Prejudice\nauthor: Jane Austen\n---\n/);
});
