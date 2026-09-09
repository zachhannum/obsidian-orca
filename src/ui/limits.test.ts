import assert from "node:assert/strict";
import { test } from "node:test";
import { CEILING } from "@/engine/pool";
import { LIMITS, MOST_BOOKS, bookCount, readLimits } from "@/ui/limits";

test("the ceiling is a setting, saved and read back in whole books", () => {
  assert.equal(LIMITS.books, CEILING);
  // Nothing saved yet, and a file written by something else.
  assert.deepEqual(readLimits(null), LIMITS);
  assert.deepEqual(readLimits({}), LIMITS);
  assert.deepEqual(readLimits({ books: "four" }), LIMITS);

  assert.deepEqual(readLimits({ books: 4 }), { books: 4 });
  assert.deepEqual(readLimits({ books: 4.5 }), { books: 4 });

  // The person with 64 GB and four books open sets it higher; nobody
  // sets it to no books at all.
  assert.equal(bookCount(MOST_BOOKS + 1), MOST_BOOKS);
  assert.equal(bookCount(0), 1);
  assert.equal(bookCount(Number.NaN), CEILING);
});

// What this tier does not cover: the tab the ceiling sits in, which is
// Obsidian's own `Setting` rows around these, and the memory a machine
// has, which is what a reader raises the ceiling against.
