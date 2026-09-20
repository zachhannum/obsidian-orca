import assert from "node:assert/strict";
import { test } from "node:test";
import { marksOn, repeatedOn, type Section } from "@/ui/reading";
import type { Drawn } from "@/book/marks";

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

test("the lines a setext heading is written on are drawn in the heading, not twice", () => {
  const note = ["A Morning Call", "Longbourn, in the Spring", "------", ""].join("\n");
  const bytes = (at: number): number =>
    new TextEncoder().encode(note.split("\n").slice(0, at).join("\n")).length;
  const heading: Drawn = {
    form: "setext",
    from: bytes(2) + 1,
    to: bytes(3),
    names: undefined,
    level: 2,
    open: 0,
  };
  const over = (lineStart: number, lineEnd: number): Section => ({
    text: note,
    lineStart,
    lineEnd,
  });

  // Obsidian draws the two lines as a paragraph and the dashes as a
  // rule, so the paragraph says what the heading will say.
  assert.equal(repeatedOn(over(0, 1), [heading]), true);
  // The section the underline is in is where the heading is drawn.
  assert.equal(repeatedOn(over(2, 2), [heading]), false);
  assert.deepEqual(marksOn(over(2, 2), [heading]), [heading]);
});

// What this tier does not cover: the drawing itself, which needs the
// DOM Obsidian hands a post processor. The e2e suite reads the chapter
// in reading view and reads the chip off each form.
