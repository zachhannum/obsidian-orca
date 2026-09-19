import assert from "node:assert/strict";
import { test } from "node:test";
import { marksOn, type Section } from "@/ui/reading";
import type { Drawn } from "@/ui/runs";

/** A note whose sections a reader is handed one at a time. */
const NOTE = ["{.epigraph}", "> A quote.", "", "A paragraph.", ""].join("\n");

/** The attribute line of that note, as the engine reads it. */
const LINE: Drawn = {
  form: "line",
  from: 0,
  to: "{.epigraph}".length,
  names: { id: undefined, classes: ["epigraph"], said: ".epigraph" },
  level: undefined,
  open: undefined,
};

function section(lineStart: number, lineEnd: number): Section {
  return { text: NOTE, lineStart, lineEnd };
}

test("a mark belongs to the section its bytes are in, and to no other", () => {
  assert.deepEqual(marksOn(section(0, 1), [LINE]), [LINE]);
  assert.deepEqual(marksOn(section(3, 3), [LINE]), []);
});

// What this tier does not cover: the drawing itself, which needs the
// DOM Obsidian hands a post processor. The e2e suite reads the chapter
// in reading view and reads the chip off each form.
