import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { cssExtensions } from "@/ui/editor";
import { marked, marks } from "@/ui/toolbar";

function editing(doc: string, caret: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: caret },
    extensions: cssExtensions(() => undefined),
  });
}

test("the toolbar holds the marks a rule is written in, and a tablet's holds the marks a selector opens with", () => {
  assert.deepEqual(marks("phone"), ["{", "}", ":", ";"]);
  assert.deepEqual(marks("tablet"), ["{", "}", ":", ";", "#", ".", "@"]);
});

test("a mark's button types the mark at the caret, as its key does", () => {
  const colon = marked(editing("p { color }", 9), ":").state;
  assert.equal(colon.doc.toString(), "p { color: }");
  assert.equal(colon.selection.main.head, 10);

  // A brace brings its pair, and a closing brace steps over it.
  const opened = marked(editing("p ", 2), "{").state;
  assert.equal(opened.doc.toString(), "p {}");
  assert.equal(opened.selection.main.head, 3);
  const closed = marked(opened, "}").state;
  assert.equal(closed.doc.toString(), "p {}");
  assert.equal(closed.selection.main.head, 4);
});

// What this tier does not cover: the toolbar on a page, which has no
// DOM here. The e2e suite taps it in Obsidian on a phone and a tablet.
// Neither tier raises a system keyboard, which mobile emulation does
// not have, so the room the sheet leaves for it is checked against a
// height the suite sets.
