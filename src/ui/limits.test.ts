import assert from "node:assert/strict";
import { test } from "node:test";
import { CEILING } from "@/engine/pool";
import { LIMITS, MOST_SESSIONS, readLimits, sessionCount } from "@/ui/limits";

test("the ceiling is a setting, saved and read back in whole sessions", () => {
  assert.equal(LIMITS.sessions, CEILING);
  // Nothing saved yet, and a file something else wrote.
  assert.deepEqual(readLimits(null), LIMITS);
  assert.deepEqual(readLimits({}), LIMITS);
  assert.deepEqual(readLimits({ sessions: "four" }), LIMITS);

  assert.deepEqual(readLimits({ sessions: 4 }), { ...LIMITS, sessions: 4 });
  assert.deepEqual(readLimits({ sessions: 4.5 }), { ...LIMITS, sessions: 4 });

  // A reader with the memory for it raises the ceiling. Nobody sets the
  // ceiling to no sessions at all.
  assert.equal(sessionCount(MOST_SESSIONS + 1), MOST_SESSIONS);
  assert.equal(sessionCount(0), 1);
  assert.equal(sessionCount(Number.NaN), CEILING);
});

test("the navigator lists headings until the setting is turned off", () => {
  assert.equal(LIMITS.headings, true);
  assert.deepEqual(readLimits({ headings: false }), { ...LIMITS, headings: false });
  assert.deepEqual(readLimits({ headings: "no" }), LIMITS);
});

test("the navigator lists every heading level until the author picks a shallower one", () => {
  assert.equal(LIMITS.deepest, 6);
  assert.deepEqual(readLimits({ deepest: 2 }), { ...LIMITS, deepest: 2 });
  // A level outside Markdown's six rounds to the nearest one it writes.
  assert.equal(readLimits({ deepest: 0 }).deepest, 1);
  assert.equal(readLimits({ deepest: 9.5 }).deepest, 6);
  assert.equal(readLimits({ deepest: "2" }).deepest, 6);
});

test("a ceiling saved under the old name reads back as the same number", () => {
  assert.deepEqual(readLimits({ books: 4 }), { ...LIMITS, sessions: 4 });
  assert.deepEqual(readLimits({ books: 4, unit: "mm" }), {
    ...LIMITS,
    sessions: 4,
    unit: "mm",
  });
  // The name the setting writes now wins over the one it wrote before.
  assert.equal(readLimits({ books: 4, sessions: 6 }).sessions, 6);
  assert.equal(readLimits({ books: "four" }).sessions, CEILING);
});

test("pages are measured in inches until the author picks another unit", () => {
  assert.equal(LIMITS.unit, "in");
  assert.equal(readLimits({ sessions: 2 }).unit, "in");
  assert.equal(readLimits({ sessions: 2, unit: "mm" }).unit, "mm");
  assert.equal(readLimits({ sessions: 2, unit: "px" }).unit, "in");
  // A unit saved without a ceiling reads back with the default ceiling.
  assert.deepEqual(readLimits({ unit: "pt" }), { ...LIMITS, unit: "pt" });
});

test("the view the last switch chose is the view the next preview opens in", () => {
  assert.equal(LIMITS.view, "single");
  assert.equal(readLimits({ view: "spread" }).view, "spread");
  assert.equal(readLimits({ view: "grid" }).view, "grid");
  // A file something else wrote, and a view orca does not have.
  assert.equal(readLimits({}).view, "single");
  assert.equal(readLimits({ view: "facing" }).view, "single");
});

// What this tier does not cover: the tab the ceiling sits in, which is
// Obsidian's own `Setting` rows around these and so holds the name and
// the line the reader reads, the memory of a machine, which is what a
// reader raises the ceiling against, and the switch that saves a view,
// which the e2e suite presses in real Obsidian.
