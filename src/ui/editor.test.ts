import assert from "node:assert/strict";
import { test } from "node:test";
import { language } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { OWN_SHEET } from "@/style/sheet";
import {
  cssExtensions,
  flagged,
  flagsAt,
  flagsIn,
  inserted,
  revealed,
  ruleExtent,
  skippedIn,
  type Flag,
} from "@/ui/editor";

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

test("a warning opened from the preview puts the caret at the line and column it named", () => {
  const state = editing();
  const reveal = (line: number, column: number): number | undefined => {
    const spec = revealed(state, line, column);
    return spec === undefined ? undefined : state.update(spec).state.selection.main.head;
  };
  assert.equal(reveal(3, 3), CSS.indexOf("text-wrap"));
  // A column past its line stops at the end of that line.
  assert.equal(reveal(1, 40), CSS.indexOf("\n"));
  assert.equal(reveal(9, 1), undefined);
});

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

test("the card over a squiggle carries the engine's message and the sheet it named", () => {
  const state = flag(editing(), [WARNED], CSS);
  const inside = state.doc.line(3).from + 4;
  assert.deepEqual(
    flagsAt(state, inside).map(({ sheet, message }) => ({ sheet, message })),
    [{ sheet: OWN_SHEET, message: WARNED.message }],
  );
  assert.deepEqual(flagsAt(state, state.doc.line(2).from + 4), []);
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

test("a rule's extent is the innermost rule the engine's line and column start", () => {
  const css = "p {\n  a: b;\n}\n@page :left {\n  @top-left { content: none; }\n}\n";
  const state = editing(css);
  const extent = (line: number, column: number): string | undefined => {
    const found = ruleExtent(state, line, column);
    return found === undefined ? undefined : state.sliceDoc(found.from, found.to);
  };
  assert.equal(extent(1, 1), "p {\n  a: b;\n}");
  assert.equal(extent(4, 1), "@page :left {\n  @top-left { content: none; }\n}");
  assert.equal(extent(5, 3), "@top-left { content: none; }");
  assert.equal(extent(9, 1), undefined);
});

test("a declaration the engine refused shows inside its rule with the engine's words", () => {
  const css = `${CSS}\nh1 {\n  text-wrap: pretty;\n}`;
  const other: Flag = { ...WARNED, line: 6, message: "another warning" };
  const state = flag(editing(css), [WARNED, other], css);
  assert.deepEqual(skippedIn(state, 1, 1), [
    { property: "text-wrap", value: "balance", message: WARNED.message },
  ]);
  assert.deepEqual(skippedIn(state, 5, 1).map(({ message }) => message), ["another warning"]);
});

test("an added rule goes in on its own lines with the caret inside it, as typing does", () => {
  const state = editing("p { a: b; }");
  const end = state.update({ selection: { anchor: state.doc.length } }).state;
  const spec = inserted(end, "h1 {\n  \n}");
  const after = end.update(spec).state;
  assert.equal(after.doc.toString(), "p { a: b; }\nh1 {\n  \n}");
  assert.equal(after.selection.main.head, "p { a: b; }\nh1 {\n  ".length);
  // Nothing marks the change as shown from the note, so the editor writes it.
  assert.equal(spec.annotations, undefined);
  // Text after the caret goes on the line below the rule.
  const middle = editing("a {}b {}").update({ selection: { anchor: 4 } }).state;
  assert.equal(middle.update(inserted(middle, "p {\n  \n}")).state.doc.toString(), "a {}\np {\n  \n}\nb {}");
  const margin = inserted(editing(""), "@page :left {\n  @top-left {\n    \n  }\n}");
  const set = editing("").update(margin).state;
  assert.equal(set.selection.main.head, "@page :left {\n  @top-left {\n    ".length);
});

// What this tier does not cover: the editor on a page, which has no
// DOM here, and the card a hover draws. The e2e suite types into it in
// Obsidian and waits on the write, the render, the squiggle and its card.
