import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cover } from "@/assets/cmap";
import {
  browsedFamily,
  browsing,
  cellOf,
  glyphAt,
  glyphName,
  sections,
} from "@/ui/glyphs";

/** A face that covers a little Latin, the Dingbats and two private use code points. */
const SPANS: readonly Cover[] = [
  { from: 0x41, to: 0x44 },
  { from: 0x2766, to: 0x2768 },
  { from: 0xe000, to: 0xe001 },
];

function named(spans: readonly Cover[]): string[] {
  return sections(spans).map((section) => section.name);
}

test("a face's code points group under the name of the block each sits in", () => {
  assert.deepEqual(named(SPANS), ["Basic Latin", "Dingbats", "Private Use Area"]);
  assert.deepEqual(
    sections(SPANS).map((section) => section.count),
    [4, 3, 2],
  );
});

test("a span that crosses a block boundary splits into one section each side", () => {
  const across: Cover[] = [{ from: 0x2fe, to: 0x301 }];
  assert.deepEqual(named(across), ["Latin Extended-B", "IPA Extensions"]);
});

test("a code point in no block falls under Other", () => {
  const between: Cover[] = [{ from: 0x2fe0, to: 0x2fe1 }];
  assert.deepEqual(named(between), ["Other"]);
});

test("the filter narrows by block name, whatever the case", () => {
  const found = browsing(SPANS, "ding", 0);
  assert.deepEqual(
    found.sections.map((section) => section.name),
    ["Dingbats"],
  );
  assert.equal(found.offered, 3);
  assert.deepEqual(
    browsing(SPANS, "DING", 0).sections.map((section) => section.name),
    ["Dingbats"],
  );
});

test("the filter narrows by hex, written three ways", () => {
  for (const typed of ["2766", "U+2766", "0x2766"]) {
    const found = browsing(SPANS, typed, 0);
    assert.equal(found.offered, 1);
    assert.equal(found.commits, 0x2766);
  }
});

test("the filter narrows by a glyph pasted into it", () => {
  const found = browsing(SPANS, "❦", 0);
  assert.equal(found.offered, 1);
  assert.equal(found.commits, 0x2766);
});

test("a filter the face answers with nothing offers nothing and commits nothing", () => {
  const none = browsing(SPANS, "2767a", 0);
  assert.deepEqual(none.sections, []);
  assert.equal(none.offered, 0);
  assert.equal(none.at, -1);
  assert.equal(none.commits, undefined);
});

test("a selected cell past the end of a narrowed list lands on its last cell", () => {
  const found = browsing(SPANS, "ding", 40);
  assert.equal(found.at, 2);
  assert.equal(found.commits, 0x2768);
});

test("a cell counts across the sections, and its code point reads back", () => {
  const all = sections(SPANS);
  assert.equal(glyphAt(all, 0), 0x41);
  assert.equal(glyphAt(all, 4), 0x2766);
  assert.equal(glyphAt(all, 8), 0xe001);
  assert.equal(glyphAt(all, 9), undefined);
  assert.equal(cellOf(all, 0x2768), 6);
  assert.equal(cellOf(all, 0x2f), -1);
});

test("the browser reads the scene break's face, the body's face, or the face orca carries", () => {
  assert.equal(browsedFamily("Noto Sans Symbols 2", "Junicode", "EB Garamond"), "Noto Sans Symbols 2");
  assert.equal(browsedFamily(undefined, "Junicode", "EB Garamond"), "Junicode");
  assert.equal(browsedFamily(undefined, undefined, "EB Garamond"), "EB Garamond");
});

test("a cell is labelled by its code point in hex", () => {
  assert.equal(glyphName(0x2766), "U+2766");
  assert.equal(glyphName(0x41), "U+0041");
  assert.equal(glyphName(0x1f650), "U+1F650");
});

// What this tier does not cover: the names Unicode gives characters,
// which orca does not ship, so the filter reads a block name, a hex
// code point and a pasted glyph and not a character's name. It does
// not cover the grid's layout or its scrolling, which the e2e suite
// photographs, and it does not cover a face large enough for the cell
// budget to matter, which no face in the fixture vault is.
