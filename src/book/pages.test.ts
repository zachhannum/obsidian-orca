import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "fleuron";
import { pageRanges } from "@/book/pages";
import type { Section } from "@/book/order";
import { DEFAULT_ROLE } from "@/book/roles";

const ENTRY = { role: DEFAULT_ROLE, heading: "" };

function note(path: string): Section {
  return { kind: "note", entry: ENTRY, path };
}

function missing(): Section {
  return { kind: "missing", entry: ENTRY };
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

// What this tier does not cover: a run whose section ids do not run in
// document order, which would mean fleuron#82 changed shape.
