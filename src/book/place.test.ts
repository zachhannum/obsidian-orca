import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page, TextItem } from "fleuron";
import {
  byteOf,
  nodesOn,
  offsetOf,
  writtenAt,
  writtenByte,
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

test("a page's nodes are the span its own runs name, and the engine's are not in it", () => {
  assert.deepEqual(nodesOn(page(3, [12, 40, 27])), { first: 12, last: 40 });
  assert.equal(nodesOn(page(4, [])), undefined);
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
// page turn and a reflow ask for them.
