import assert from "node:assert/strict";
import { test } from "node:test";
import type { Properties } from "@/book/frontmatter";
import { books, isBook, type NoteIndex } from "@/ui/books";

/** A vault whose notes answer from the metadata cache and nowhere else. */
function index(cached: Record<string, Properties>): NoteIndex & {
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    notes: () => Object.keys(cached).map((path) => ({ path })),
    properties: (note) => {
      asked.push(note.path);
      return cached[note.path];
    },
  };
}

test("a vault-wide scan for books is a metadata-cache lookup, not a directory walk", () => {
  const vault = index({
    "Pride and Prejudice.md": { "orca-book": 1, title: "Pride and Prejudice" },
    "Chapter Twelve.md": { title: "Chapter Twelve" },
    "The Voyage to Lilliput.md": { "orca-book": 1 },
    "Notes.md": {},
  });

  assert.deepEqual(
    books(vault).map((note) => note.path),
    ["Pride and Prejudice.md", "The Voyage to Lilliput.md"],
  );
  // Every note was answered from the cache, and none was opened.
  assert.deepEqual(vault.asked, [
    "Pride and Prejudice.md",
    "Chapter Twelve.md",
    "The Voyage to Lilliput.md",
    "Notes.md",
  ]);
  assert.equal(isBook(vault, { path: "Chapter Twelve.md" }), false);
  assert.equal(isBook(vault, { path: "Nowhere.md" }), false);
});

// What this tier does not cover: the cache Obsidian keeps, and the
// navigator that lists what this finds, which waits on its own issue.
