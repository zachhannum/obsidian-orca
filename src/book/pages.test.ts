import assert from "node:assert/strict";
import { test } from "node:test";
import type { Folios, NodeSource, Page } from "fleuron";
import {
  chapters,
  placeOf,
  sectionOf,
  sectionOn,
  sectionRanges,
  sectionsOn,
  sourceNamed,
  stepChapter,
  type Placing,
} from "@/book/pages";
import type { Section } from "@/book/order";
import { DEFAULT_ROLE } from "@/book/roles";

const ENTRY = { role: DEFAULT_ROLE, heading: "" };

function note(path: string): Section {
  return { kind: "note", entry: ENTRY, path };
}

function missing(): Section {
  return { kind: "missing", entry: ENTRY };
}

function generated(): Section {
  return { kind: "generated", entry: { ...ENTRY, role: "title-page" } };
}

function named(alias: string): Section {
  return { kind: "note", entry: { ...ENTRY, alias }, path: `${alias}.md` };
}

/** A page naming the section ids it holds content from. */
function page(number: number, sections: number[]): Page {
  return {
    number,
    side: "recto",
    width: 432,
    height: 648,
    sections,
    items: [],
  };
}

/** An engine that answers from what it was told, node by node. */
function engine(
  answers: Record<number, { source: string; folios: [number, number] }>,
): Placing {
  return {
    sourceOf: (node): Promise<NodeSource | null> => {
      const answer = answers[node];
      return Promise.resolve(
        answer === undefined
          ? null
          : { source: answer.source, start: 0, end: 1 },
      );
    },
    foliosOf: (nodes): Promise<(Folios | null)[]> =>
      Promise.resolve(
        nodes.map((node) => {
          const answer = answers[node];
          if (answer === undefined) return null;
          const [first, last] = answer.folios;
          return { first, last, at: first - 1, count: last - first + 1 };
        }),
      ),
  };
}

test("a section's range is the entry the engine says the run was read from", async () => {
  const sections = [note("a.md"), note("b.md"), note("c.md")];
  const pages = [page(1, [5]), page(2, [5, 44]), page(4, [44, 90])];
  const answers = {
    5: { source: "a.md", folios: [1, 2] as [number, number] },
    44: { source: "b.md", folios: [2, 4] as [number, number] },
    90: { source: "c.md", folios: [4, 5] as [number, number] },
  };

  const ranges = await sectionRanges(sections, pages, engine(answers));

  assert.deepEqual(ranges.get(0), { first: 1, last: 2 });
  assert.deepEqual(ranges.get(1), { first: 2, last: 4 });
  assert.deepEqual(ranges.get(2), { first: 4, last: 5 });
});

test("a run yielding fewer sections than were sent moves no other entry", async () => {
  const sections = [note("a.md"), note("b.md"), note("c.md")];
  // The run named nothing for b.md, which pairing ids by ordinal would
  // have read as c.md's run.
  const pages = [page(1, [5]), page(2, [90])];
  const answers = {
    5: { source: "a.md", folios: [1, 1] as [number, number] },
    90: { source: "c.md", folios: [2, 2] as [number, number] },
  };

  const ranges = await sectionRanges(sections, pages, engine(answers));

  assert.deepEqual(ranges.get(0), { first: 1, last: 1 });
  assert.equal(ranges.get(1), undefined);
  assert.deepEqual(ranges.get(2), { first: 2, last: 2 });
});

test("a run still typesetting has no pages, so no section has a range", async () => {
  const sections = [note("a.md")];

  assert.equal((await sectionRanges(sections, [], engine({}))).size, 0);
});

test("a section crosses under the name the engine calls its source by", () => {
  const sections = [generated(), missing(), note("c.md"), generated()];

  assert.equal(sourceNamed(sections, 0), "orca-generated:0");
  assert.equal(sourceNamed(sections, 1), undefined);
  assert.equal(sourceNamed(sections, 2), "c.md");
  // The generated name counts the sections sent, so the one resolve
  // dropped is not counted.
  assert.equal(sourceNamed(sections, 3), "orca-generated:2");

  assert.equal(placeOf(sections, "orca-generated:2"), 3);
  assert.equal(placeOf(sections, "c.md"), 2);
  assert.equal(placeOf(sections, "gone.md"), undefined);
});

test("a note is found at the place its section has in the reading order", () => {
  const sections = [note("a.md"), missing(), note("c.md")];

  assert.equal(sectionOf(sections, "c.md"), 2);
  assert.equal(sectionOf(sections, "gone.md"), undefined);
});

test("a span reads as the last section its pages name, and holds the one turned to", () => {
  const places = new Map([
    [5, 0],
    [44, 1],
    [90, 2],
  ]);

  assert.deepEqual(sectionsOn([page(1, [5]), page(2, [44, 5])]), [5, 44]);
  // A page carrying the end of one section and the opening of the next
  // belongs to the one the reader is now in, and so does a spread.
  assert.equal(sectionOn([page(2, [5, 44])], places), 1);
  assert.equal(sectionOn([page(2, [5]), page(3, [5, 44])], places), 1);
  // A screenful holding several is at the last of them, until the
  // reader turns to one of the others.
  const screenful = [page(1, [5]), page(2, [5, 44]), page(3, [90])];
  assert.equal(sectionOn(screenful, places), 2);
  assert.equal(sectionOn(screenful, places, 0), 0);
  // A chapter the run named nothing for is nowhere the span can be at.
  assert.equal(sectionOn(screenful, places, 7), 2);
  // A blank verso names none, and reads as whatever opened before it.
  assert.equal(sectionOn([page(4, [])], places), undefined);
  assert.equal(sectionOn([], places), undefined);
});

test("the chapters offered are the ones the book set, named and in order", () => {
  const sections = [named("One"), missing(), named("Two")];

  assert.deepEqual(chapters(sections), [
    { at: 0, name: "One" },
    { at: 2, name: "Two" },
  ]);
});

test("a chapter turn steps along the reading order and stops at either end", () => {
  const offered = chapters([named("One"), named("Two"), named("Three")]);

  assert.deepEqual(stepChapter(offered, 1, 1), { at: 2, name: "Three" });
  assert.deepEqual(stepChapter(offered, 1, -1), { at: 0, name: "One" });
  assert.equal(stepChapter(offered, 2, 1), undefined);
  assert.equal(stepChapter(offered, 0, -1), undefined);
  assert.equal(stepChapter(offered, undefined, 1), undefined);
});

// What this tier does not cover: the chapter control itself, which the
// e2e job names and turns through a reflow, and a book whose reading
// order lists one note twice, which crosses as two sources of the same
// name and is answered at the first of them.
