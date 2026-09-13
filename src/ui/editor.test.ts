import assert from "node:assert/strict";
import { test } from "node:test";
import { language } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { OWN_SHEET } from "@/style/sheet";
import { cssExtensions, flagged, flagsIn, type Flag } from "@/ui/editor";

const CSS = "p {\n  text-indent: 2em;\n  text-wrap: balance;\n}";

const WARNED: Flag = {
  sheet: OWN_SHEET,
  line: 3,
  column: 3,
  message: "unsupported property `text-wrap`",
};

function editing(doc = CSS): EditorState {
  return EditorState.create({ doc, extensions: cssExtensions(() => undefined) });
}

function flag(state: EditorState, flags: readonly Flag[], against: string): EditorState {
  const spec = flagged(state, flags, against);
  return spec === undefined ? state : state.update(spec).state;
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

test("every flag in the editor comes from a warning the engine sent", () => {
  const state = editing();
  assert.deepEqual(flagsIn(state), []);
  // Text the grammar knows no property of is not flagged by the editor.
  assert.deepEqual(flagsIn(state.update({ changes: { from: 0, insert: "q { zzz: 1 }\n" } }).state), []);
  assert.deepEqual(flagsIn(flag(state, [WARNED], CSS)).map((found) => found.message), [
    WARNED.message,
  ]);
  assert.deepEqual(flagsIn(flag(flag(state, [WARNED], CSS), [], CSS)), []);
});

test("a book.css warning is underlined at the line and column it named", () => {
  const state = flag(editing(), [WARNED], CSS);
  const [found] = flagsIn(state);
  assert.ok(found);
  assert.equal(state.doc.lineAt(found.from).number, 3);
  assert.equal(found.from - state.doc.line(3).from, 2);
  assert.match(state.sliceDoc(found.from, found.to), /^text-wrap: balance;?$/);
});

test("a render's warnings wait for the text it set, and the flags on the text move with the typing", () => {
  const flaggedState = flag(editing(), [WARNED], CSS);
  const typed = flaggedState.update({ changes: { from: 0, insert: "/* mine */\n" } }).state;
  const before = flagsIn(typed);
  // The render set the CSS before the comment, so its flags do not land.
  const kept = flag(typed, [], CSS);
  assert.deepEqual(flagsIn(kept), before);
  assert.equal(kept.doc.lineAt(before[0]?.from ?? 0).number, 4);
});

// What this tier does not cover: the editor on a page, which has no
// DOM here. The e2e suite types into it in Obsidian and waits on the
// write, the render and the squiggle that follow.
