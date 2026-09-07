import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "fleuron";
import {
  chapters,
  pageRanges,
  sectionAt,
  sectionOf,
  stepChapter,
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

function named(alias: string): Section {
  return { kind: "note", entry: { ...ENTRY, alias }, path: `${alias}.md` };
}

/** A page naming the section ids it holds content from. */
function page(number: number, sections: number[]): Page {
  return { number, side: "recto", width: 432, height: 648, sections, items: [] };
}

test("a section's range is the first and last folio its id lands on", () => {
  const sections = [note("a.md"), note("b.md"), note("c.md")];
  const pages = [
    page(1, [5]),
    page(2, [5, 44]),
    page(3, [44]),
    page(4, [44, 90]),
    page(5, [90]),
  ];

  const ranges = pageRanges(sections, pages);

  assert.deepEqual(ranges.get(0), { first: 1, last: 2 });
  assert.deepEqual(ranges.get(1), { first: 2, last: 4 });
  assert.deepEqual(ranges.get(2), { first: 4, last: 5 });
});

test("a section resolve dropped never got an id to look up", () => {
  const sections = [note("a.md"), missing(), note("c.md")];
  const pages = [page(1, [7]), page(2, [20])];

  const ranges = pageRanges(sections, pages);

  assert.deepEqual(ranges.get(0), { first: 1, last: 1 });
  assert.equal(ranges.get(1), undefined);
  assert.deepEqual(ranges.get(2), { first: 2, last: 2 });
});

test("a section no page names yet has no range", () => {
  const sections = [note("a.md"), note("b.md")];
  const pages = [page(1, [9])];

  const ranges = pageRanges(sections, pages);

  assert.deepEqual(ranges.get(0), { first: 1, last: 1 });
  assert.equal(ranges.get(1), undefined);
});

test("a run still laying out has no pages, so no section has a range", () => {
  const sections = [note("a.md")];

  assert.equal(pageRanges(sections, []).size, 0);
});

test("a note is found at the place its section has in the reading order", () => {
  const sections = [note("a.md"), missing(), note("c.md")];

  assert.equal(sectionOf(sections, "c.md"), 2);
  assert.equal(sectionOf(sections, "gone.md"), undefined);
});

test("a folio reads as the last section to open on or before it", () => {
  const ranges = new Map([
    [0, { first: 1, last: 2 }],
    [1, { first: 2, last: 4 }],
    [2, { first: 4, last: 5 }],
  ]);

  // Page 2 carries the end of one section and the opening of the next,
  // and the reader is in the one that opened.
  assert.equal(sectionAt(ranges, 1), 0);
  assert.equal(sectionAt(ranges, 2), 1);
  assert.equal(sectionAt(ranges, 3), 1);
  assert.equal(sectionAt(ranges, 4), 2);
});

test("a folio before the first section has opened reads as no section", () => {
  const ranges = new Map([[0, { first: 3, last: 4 }]]);

  assert.equal(sectionAt(ranges, 1), undefined);
  assert.equal(sectionAt(new Map(), 1), undefined);
});

test("the chapters offered are the ones the book set, named and in order", () => {
  const sections = [named("One"), missing(), named("Two"), named("Three")];
  const ranges = new Map([
    [0, { first: 1, last: 3 }],
    [2, { first: 4, last: 6 }],
  ]);

  // Three has no range because the run laid no page for it, so it is
  // nowhere a reader can turn to.
  assert.deepEqual(chapters(sections, ranges), [
    { at: 0, name: "One", first: 1 },
    { at: 2, name: "Two", first: 4 },
  ]);
});

test("a chapter turn steps along the reading order and stops at either end", () => {
  const sections = [named("One"), named("Two"), named("Three")];
  const ranges = new Map([
    [0, { first: 1, last: 3 }],
    [1, { first: 4, last: 6 }],
    [2, { first: 7, last: 9 }],
  ]);
  const offered = chapters(sections, ranges);

  assert.deepEqual(stepChapter(offered, 1, 1), {
    at: 2,
    name: "Three",
    first: 7,
  });
  assert.deepEqual(stepChapter(offered, 1, -1), {
    at: 0,
    name: "One",
    first: 1,
  });
  assert.equal(stepChapter(offered, 2, 1), undefined);
  assert.equal(stepChapter(offered, 0, -1), undefined);
  assert.equal(stepChapter(offered, undefined, 1), undefined);
});

test("a page no section covers is named for the chapter that opened before it", () => {
  const sections = [named("One"), named("Two")];
  // Two opens recto, so the verso before it is blank and carries no
  // section at all.
  const ranges = new Map([
    [0, { first: 1, last: 3 }],
    [1, { first: 5, last: 8 }],
  ]);
  const offered = chapters(sections, ranges);

  assert.equal(sectionAt(ranges, 4), 0);
  assert.deepEqual(stepChapter(offered, sectionAt(ranges, 4), 1), {
    at: 1,
    name: "Two",
    first: 5,
  });
});

// What this tier does not cover: a run whose section ids do not run in
// document order, which would mean fleuron#82 changed shape, and the
// chapter control itself, which the e2e job names and turns.
