import assert from "node:assert/strict";
import { test } from "node:test";
import { notedBook, type NotePane } from "@/ui/manuscript";

const BOOK = "Pride and Prejudice.md";
const SECOND = "The Bennet Novels.md";

function pane(pane: Partial<NotePane>): NotePane {
  return { book: BOOK, shown: true, active: false, ...pane };
}

test("the active note's book is the book the panel designs", () => {
  const panes = [pane({ book: SECOND }), pane({ active: true })];

  assert.equal(notedBook(panes), BOOK);
});

test("with no active note, the first note on screen names the book", () => {
  const panes = [pane({ book: SECOND }), pane({})];

  assert.equal(notedBook(panes), SECOND);
});

test("a note in a background tab designs nothing", () => {
  const panes = [pane({ shown: false, active: true })];

  assert.equal(notedBook(panes), undefined);
});

test("a note no book reads is passed over for one that belongs to a book", () => {
  const panes = [pane({ book: undefined, active: true }), pane({})];

  assert.equal(notedBook(panes), BOOK);
});

// What this tier does not cover: which panes Obsidian calls drawn and
// active, which is the plugin's, and the e2e suite's.
