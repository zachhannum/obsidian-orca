import assert from "node:assert/strict";
import { test } from "node:test";
import { linksIn, pathLinks, target } from "@/book/links";

const PATHS = [
  "Pride and Prejudice.md",
  "Chapter Twelve.md",
  "Volume One/Chapter Four.md",
  "Volume Two/Chapter Four.md",
];

test("a link finds the note of that name nearest the note it is in", () => {
  const links = pathLinks(PATHS);

  assert.equal(links.find("Chapter Twelve", "Pride and Prejudice.md"), "Chapter Twelve.md");
  assert.equal(
    links.find("Chapter Four", "Volume Two/Chapter Nine.md"),
    "Volume Two/Chapter Four.md",
  );
  assert.equal(
    links.find("Volume One/Chapter Four", "Pride and Prejudice.md"),
    "Volume One/Chapter Four.md",
  );
  assert.equal(links.find("Chapter Twelve.md", "Pride and Prejudice.md"), "Chapter Twelve.md");
  assert.equal(links.find("Chapter Nine", "Pride and Prejudice.md"), undefined);
});

test("a link's alias, heading and block are not part of the name", () => {
  assert.equal(target("Chapter Twelve|the carriage"), "Chapter Twelve");
  assert.equal(target("Chapter Twelve#Netherfield"), "Chapter Twelve");
  assert.equal(target("Chapter Twelve^a1b2"), "Chapter Twelve");

  const links = pathLinks(PATHS);
  assert.equal(
    links.find("Chapter Twelve#Netherfield|the carriage", "Pride and Prejudice.md"),
    "Chapter Twelve.md",
  );
});

test("a paste is read for the links in it, as they were written", () => {
  assert.deepEqual(
    linksIn("- [[Chapter Twelve]]\n- [[Volume the First|Volume I]]\n"),
    ["Chapter Twelve", "Volume the First|Volume I"],
  );
  assert.deepEqual(linksIn("Chapter Twelve"), []);
  assert.deepEqual(linksIn("[[]]"), []);
});

// What this tier does not cover: Obsidian's own resolution through
// the metadata cache, which the e2e job runs, and links to anything
// that is not a note.
