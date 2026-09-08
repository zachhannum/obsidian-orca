import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page, TextItem } from "fleuron";
import { byteOf, folioOf, nodesOn, offsetOf, writtenAt } from "@/book/place";

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
    features: { smallCaps: false },
    color: "#000000",
    glyphs: [],
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

/** A book whose pages name the nodes `spans` gives them, folio by folio. */
function reads(spans: number[][]): (folio: number) => Promise<Page | undefined> {
  return (folio) => {
    const nodes = spans[folio - 1];
    return Promise.resolve(
      nodes === undefined ? undefined : page(folio, nodes),
    );
  };
}

test("a page's nodes are the span its own runs name, and the engine's are not in it", () => {
  assert.deepEqual(nodesOn(page(3, [12, 40, 27])), { first: 12, last: 40 });
  assert.equal(nodesOn(page(4, [])), undefined);
});

test("the folio a node is set on is found by halving the chapter", async () => {
  const read = reads([[4, 9], [10, 19], [20, 29], [30, 39], [40, 44]]);
  const within = { first: 1, last: 5 };
  assert.equal(await folioOf(25, within, read), 3);
  assert.equal(await folioOf(4, within, read), 1);
  assert.equal(await folioOf(44, within, read), 5);
  // A node the range runs out before is nowhere to turn to.
  assert.equal(await folioOf(200, within, read), undefined);
});

test("a node no run names is set on the page its content begins on", async () => {
  // A heading's runs are shaped from the text inside it, so the node a
  // byte of its markup was read into names no run of its own.
  const read = reads([[4, 9], [12, 19], [22, 29]]);
  const within = { first: 1, last: 3 };
  assert.equal(await folioOf(3, within, read), 1);
  assert.equal(await folioOf(11, within, read), 2);
  assert.equal(await folioOf(21, within, read), 3);
});

test("a page the engine wrote alone is stood in for by the nearest that names a node", async () => {
  const read = reads([[4, 9], [], [20, 29], [], [40, 44]]);
  const within = { first: 1, last: 5 };
  assert.equal(await folioOf(22, within, read), 3);
  assert.equal(await folioOf(41, within, read), 5);
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

// What this tier does not cover: the node a byte was read into and the
// source a node was read from, which are the engine's own answers, and
// the e2e job is where a cursor and a page turn ask for them.
