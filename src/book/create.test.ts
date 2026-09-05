import assert from "node:assert/strict";
import { test } from "node:test";
import { MATTER, byName, newBook } from "@/book/create";
import { readModel, writeModel } from "@/book/model";
import { BOOK_KEY } from "@/book/note";
import { entries, entryName, groups } from "@/book/order";

test("a folder of notes becomes a book in sorted order, and an empty book is the same note without them", () => {
  const found = ["Chapter Twelve", "Chapter Four", "Chapter 2", "Chapter 10"];

  const model = newBook({ title: "Chapters" }, [...found].sort(byName));

  assert.deepEqual(entries(model.order).map(entryName), [
    "Chapter 2",
    "Chapter 10",
    "Chapter Four",
    "Chapter Twelve",
  ]);
  // Every group is written, so every role is one drag away.
  assert.deepEqual(
    groups(model.order).map((group) => group.heading),
    [...MATTER],
  );
  assert.deepEqual(
    entries(model.order).map((entry) => entry.role),
    ["chapter", "chapter", "chapter", "chapter"],
  );

  const note = writeModel(model);
  assert.match(note, new RegExp(`^---\\n${BOOK_KEY}: 1\\ntitle: Chapters\\n---\\n`));
  assert.match(note, /\n# Body\n\n- \[\[Chapter 2\]\]\n/);
  // The note orca wrote is the note orca reads.
  assert.equal(writeModel(readModel(note)), note);

  const empty = newBook({}, []);
  assert.deepEqual(entries(empty.order), []);
  assert.deepEqual(
    groups(empty.order).map((group) => group.heading),
    [...MATTER],
  );
  assert.equal(writeModel(readModel(writeModel(empty))), writeModel(empty));
});

// What this tier does not cover: where in the vault the note lands and
// what it is called, which is Obsidian's own naming and is covered by
// the e2e suite.
