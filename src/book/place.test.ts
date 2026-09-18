import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page, TextItem } from "fleuron";
import {
  anchorOf,
  byteOf,
  heldOn,
  nodesOn,
  offsetOf,
  opensOn,
  pagesOf,
  shownOver,
  writtenAt,
  writtenByte,
  type Landed,
  type ReadPage,
  type Runs,
  type Seen,
  type Written,
} from "@/book/place";

/** A run of a page, named for the node it was shaped from. */
function run(node: number | undefined): TextItem {
  return {
    kind: "text",
    x: 54,
    y: 73,
    fontId: 0,
    size: 12,
    text: "words",
    source: "",
    sourceMap: [],
    origin: node === undefined ? null : { node, range: [0, 5] },
    pseudoElement: null,
    features: { smallCaps: false },
    color: "#000000",
    glyphs: [],
    layer: 0,
  };
}

/** A page whose runs name `nodes`, and a folio the engine wrote alone. */
function page(number: number, nodes: number[]): Page {
  return {
    number,
    side: number % 2 === 1 ? "recto" : "verso",
    width: 432,
    height: 648,
    sections: [],
    items: [run(undefined), ...nodes.map((node) => run(node))],
  };
}

test("a page's nodes are the span its own runs name, and the engine's are not in it", () => {
  assert.deepEqual(nodesOn(page(3, [12, 40, 27])), { first: 12, last: 40 });
  assert.equal(nodesOn(page(4, [])), undefined);
});

/** A run at a baseline, over the bytes of a node it was shaped from. */
function set(line: Written, y: number): TextItem {
  return {
    ...run(line.node),
    y,
    origin: { node: line.node, range: [line.from, line.to] },
  };
}

/** A page of these lines, one to a baseline, under a folio the engine wrote. */
function sheet(number: number, lines: Written[]): Page {
  return {
    ...page(number, []),
    items: [run(undefined), ...lines.map((line, at) => set(line, 73 + at * 14))],
  };
}

/** Lines of one node, `bytes` bytes each, from `from`. */
function lined(node: number, from: number, bytes: number, count: number): Written[] {
  return Array.from({ length: count }, (_, at) => ({
    node,
    from: from + at * bytes,
    to: from + (at + 1) * bytes,
  }));
}

/** Reads the book these pages are, counting from 0. */
function book(pages: Page[]): ReadPage {
  return (at) => Promise.resolve(pages[at]);
}

/** The pages `node` runs across, over a book of these pages. */
function runsOf(pages: Page[], node: number): Runs {
  const on = pages.flatMap((page, at) =>
    heldOn(page).some((held) => held.node === node) ? [at] : [],
  );
  const at = on[0] ?? 0;
  return { at, count: on.length };
}

/** The pages the blocks of the reader's page landed on, over a book of these pages. */
async function landed(held: Written[], pages: Page[]): Promise<Landed[]> {
  const found: Landed[] = [];
  for (const block of held) {
    found.push(...(await pagesOf(block, runsOf(pages, block.node), book(pages))));
  }
  return found;
}

test("a reflow comes back to the page now setting the blocks the reader's page held", async () => {
  const held = heldOn(
    sheet(50, [
      ...lined(10, 90, 30, 4),
      ...lined(11, 0, 30, 8),
      ...lined(12, 0, 40, 2),
    ]),
  );
  assert.deepEqual(held, [
    { node: 10, from: 90, to: 210 },
    { node: 11, from: 0, to: 240 },
    { node: 12, from: 0, to: 80 },
  ]);

  // The reflow moved all three blocks a page along, and split the one
  // the page opened with over the page before.
  const pages = [
    sheet(59, lined(9, 0, 30, 10)),
    sheet(60, [...lined(9, 300, 30, 4), ...lined(10, 0, 30, 3)]),
    sheet(61, [
      ...lined(10, 90, 30, 4),
      ...lined(11, 0, 30, 8),
      ...lined(12, 0, 40, 2),
    ]),
  ];
  assert.equal(anchorOf(await landed(held, pages)), 2);
});

test("a page that opens mid-paragraph comes back to the page setting its own lines", async () => {
  // The reader's page opens 240 bytes into a paragraph, so the lines
  // before that are on the page before and are not the reader's place.
  const held = heldOn(sheet(50, [...lined(20, 240, 40, 9), ...lined(21, 0, 40, 3)]));
  const pages = [
    // The paragraph starts here, which is where the old anchor turned to.
    sheet(60, lined(20, 0, 40, 6)),
    sheet(61, [...lined(20, 240, 40, 9), ...lined(21, 0, 40, 3)]),
  ];
  assert.equal(anchorOf(await landed(held, pages)), 1);
});

test("a page inside one long paragraph comes back to a page of it, not to its first", async () => {
  const held = heldOn(sheet(50, lined(30, 4300, 40, 38)));
  assert.deepEqual(held, [{ node: 30, from: 4300, to: 5820 }]);

  // One paragraph over five pages. The reader's own bytes begin at the
  // foot of the third and run through the fourth, which sets most of
  // them, so that is the page and not the one they begin on.
  const pages = Array.from({ length: 5 }, (_, at) =>
    sheet(70 + at, lined(30, at * 1480, 40, 37)),
  );
  assert.deepEqual(await landed(held, pages), [
    { at: 2, holds: 4 },
    { at: 3, holds: 35 },
  ]);
  assert.equal(anchorOf(await landed(held, pages)), 3);

  // A page the engine wrote alone sets no block of its own, so there is
  // nowhere for a reflow to turn to.
  assert.deepEqual(heldOn(sheet(51, [])), []);
  assert.equal(anchorOf([]), undefined);
});

test("a page opens at the block it begins, not at the sliver carried over above it", () => {
  // The page opens on the tail of one paragraph and then sets two of its
  // own, so the first of those two is where it opens.
  const held = heldOn(
    sheet(50, [
      ...lined(10, 900, 30, 2),
      ...lined(11, 0, 30, 20),
      ...lined(12, 0, 30, 9),
    ]),
  );
  assert.equal(opensOn(held), 11);

  // A page wholly inside one paragraph begins no block of its own, so it
  // opens at the one it is inside.
  assert.equal(opensOn(heldOn(sheet(51, lined(30, 3000, 40, 34)))), 30);
  assert.equal(opensOn([]), undefined);
});

test("two blocks landing on one page count their lines together, and a tie goes to the earlier", () => {
  assert.equal(anchorOf([{ at: 9, holds: 4 }, { at: 8, holds: 3 }, { at: 8, holds: 2 }]), 8);
  assert.equal(anchorOf([{ at: 9, holds: 3 }, { at: 8, holds: 3 }]), 8);
});

test("a byte of a note and the character it falls in name each other", () => {
  const text = "Une soirée\nà Netherfield";
  assert.equal(byteOf(text, 0), 0);
  // The acute is two bytes, so the byte count runs ahead of the caret.
  assert.equal(byteOf(text, 10), 11);
  assert.equal(offsetOf(text, 11), 10);
  // A byte inside a character answers with the character it is part of.
  assert.equal(offsetOf(text, 10), 9);
  assert.equal(offsetOf(text, 0), 0);
  assert.equal(offsetOf(text, 1000), text.length);
});

test("a pane counts the pixels of each block it shows, not the blocks", () => {
  const note = [
    "---",
    "title: Pride and Prejudice",
    "---",
    "",
    "# Chapter Twelve",
    "",
    "In consequence of an agreement",
    "between the sisters, Elizabeth",
    "wrote the next morning.",
    "",
    "Her answer was not propitious.",
  ].join("\n");

  /** Lines `from` to `to`, each showing `pixels` of itself. */
  const seen = (from: number, to: number, pixels: number): Seen[] =>
    Array.from({ length: to - from + 1 }, (_, at) => ({
      line: from + at,
      pixels,
    }));

  // The heading, the paragraph under it and the one under that, each
  // carrying the rows it is set over.
  assert.deepEqual(shownOver(note, seen(4, 10, 20)), [
    { at: 36, pixels: 20 },
    { at: 54, pixels: 60 },
    { at: 141, pixels: 20 },
  ]);

  // A heading with a sliver of it left at the top carries that sliver,
  // and loses to the paragraph filling the rest of the pane.
  assert.deepEqual(
    shownOver(note, [{ line: 4, pixels: 3 }, ...seen(6, 8, 20)]),
    [
      { at: 36, pixels: 3 },
      { at: 54, pixels: 60 },
    ],
  );

  // A blank line is in no block, and the note's own frontmatter is no
  // block of the book.
  assert.deepEqual(shownOver(note, seen(0, 3, 20)), []);
});

test("a scroll that stops on a blank line reads the line under it", () => {
  const note = [
    "---",
    "title: Pride and Prejudice",
    "---",
    "",
    "# Chapter Twelve",
    "",
    "In consequence of an agreement.",
  ].join("\n");
  // The top of the note is its frontmatter, which is no node of the book.
  assert.equal(writtenAt(note, 0), 4);
  assert.equal(writtenAt(note, 4), 4);
  assert.equal(writtenAt(note, 5), 6);
  // A note with nothing under the line asked for stays where it is.
  assert.equal(writtenAt(note, 99), 6);
  assert.equal(writtenAt("# Loose\n\nA note.\n", 0), 0);
});

test("a section is asked about at the first byte anything was read from", () => {
  const note = [
    "---",
    "title: Pride and Prejudice",
    "---",
    "",
    "# Chapter Twelve",
  ].join("\n");
  // Byte 0 is the frontmatter, which the engine read into no node, so
  // the question is asked at the heading instead.
  assert.equal(writtenByte(note), 36);
  assert.equal(writtenByte("# Loose\n"), 0);
});

// What this tier does not cover: the node a byte was read into, the
// source a node was read from and the folios a node is set on, which
// are the engine's own answers, and the e2e job is where a cursor, a
// page turn and a reflow ask for them. Nor the pairing a spread does
// around the page a reflow lands on, which the view owns.
