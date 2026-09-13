import assert from "node:assert/strict";
import { test } from "node:test";
import { language } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { cssExtensions } from "@/ui/editor";

function editing(): EditorState {
  return EditorState.create({
    doc: "p {\n  text-indent: 2em;\n}",
    extensions: cssExtensions(() => undefined),
  });
}

test("the editor sets its text in the CSS grammar", () => {
  assert.equal(editing().facet(language)?.name, "css");
});

test("the editor carries a CSS language mode and nothing more", () => {
  const state = editing();
  for (const at of [0, 6, state.doc.length]) {
    assert.deepEqual(state.languageDataAt("autocomplete", at), []);
  }
});

// What this tier does not cover: the editor on a page, which has no
// DOM here. The e2e suite types into it in Obsidian and waits on the
// write and the render that follow.
