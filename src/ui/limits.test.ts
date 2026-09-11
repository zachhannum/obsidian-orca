import assert from "node:assert/strict";
import { test } from "node:test";
import { CEILING } from "@/engine/pool";
import { LIMITS, MOST_BOOKS, bookCount, readLimits } from "@/ui/limits";

test("the ceiling is a setting, saved and read back in whole books", () => {
  assert.equal(LIMITS.books, CEILING);
  // Nothing saved yet, and a file something else wrote.
  assert.deepEqual(readLimits(null), LIMITS);
  assert.deepEqual(readLimits({}), LIMITS);
  assert.deepEqual(readLimits({ books: "four" }), LIMITS);

  assert.deepEqual(readLimits({ books: 4 }), { books: 4, unit: "in" });
  assert.deepEqual(readLimits({ books: 4.5 }), { books: 4, unit: "in" });

  // A reader with the memory for it raises the ceiling. Nobody sets the
  // ceiling to no books at all.
  assert.equal(bookCount(MOST_BOOKS + 1), MOST_BOOKS);
  assert.equal(bookCount(0), 1);
  assert.equal(bookCount(Number.NaN), CEILING);
});

test("pages are measured in inches until the author picks another unit", () => {
  assert.equal(LIMITS.unit, "in");
  assert.equal(readLimits({ books: 2 }).unit, "in");
  assert.equal(readLimits({ books: 2, unit: "mm" }).unit, "mm");
  assert.equal(readLimits({ books: 2, unit: "px" }).unit, "in");
  // A unit read back leaves the ceiling it was saved with.
  assert.deepEqual(readLimits({ unit: "pt" }), { books: LIMITS.books, unit: "pt" });
});

// What this tier does not cover: the tab the ceiling sits in, which is
// Obsidian's own `Setting` rows around these, and the memory of a
// machine, which is what a reader raises the ceiling against.
