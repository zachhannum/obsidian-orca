import assert from "node:assert/strict";
import { test } from "node:test";
import { language } from "@codemirror/language";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { SUBSET } from "fleuron";
import { OWN_SHEET } from "@/style/sheet";
import {
  cssExtensions,
  flagged,
  fontCompletion,
  fonted,
  flagsAt,
  flagsIn,
  inserted,
  revealed,
  ruleExtent,
  propertyCompletion,
  sectioned,
  selectorCompletion,
  valueCompletion,
  namedCompletion,
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

test("a font-family value completes from the fonts the book carries", () => {
  const doc = 'h1 {\n  font-family: ;\n  font-size: ;\n}\n';
  const state = editing(doc).update(fonted(["Junicode", "Junicode Cond", "Alegreya"])).state;
  const complete = (at: number): CompletionResult | null =>
    fontCompletion(new CompletionContext(state, at, true));

  const offered = complete(doc.indexOf("font-family: ") + "font-family: ".length);
  assert.deepEqual(offered?.options.map((option) => option.label), [
    "Junicode",
    "Junicode Cond",
    "Alegreya",
  ]);
  // A name of more than one word goes in quoted, so it reads as one family.
  assert.equal(offered?.options[1]?.apply, '"Junicode Cond"');
  // Only a font-family value completes a family.
  assert.equal(complete(doc.indexOf("font-size: ") + "font-size: ".length), null);
  assert.equal(complete(0), null);

  // A partly typed name narrows the list, quote and all, and the
  // completion replaces the whole family it sits in.
  const into = doc.indexOf("font-family: ") + "font-family: ".length;
  const typing = state.update({ changes: { from: into, insert: '"Junicode C' } }).state;
  const narrowed = fontCompletion(
    new CompletionContext(typing, into + '"Junicode C'.length, true),
  );
  assert.deepEqual(narrowed?.options.map((option) => option.label), ["Junicode Cond"]);
  assert.equal(typing.sliceDoc(narrowed?.from, narrowed?.to), '"Junicode C');
});

type Source = (context: CompletionContext) => CompletionResult | null;

/** The labels a source offers at the end of the text, as typing asks rather than a key. */
function offered(source: Source, doc: string, at = doc.length): string[] | undefined {
  const named = [
    { role: "title-page", id: "title-page" },
    { role: "chapter", id: "the-harbor" },
    { role: "chapter", id: "the-lighthouse" },
  ] as const;
  const state = editing(doc).update(sectioned(named)).state;
  return source(new CompletionContext(state, at, false))?.options.map((option) => option.label);
}

test("a property name completes, and the names offered are the ones the pinned engine sets", () => {
  const names = (list: readonly { name: string }[]): string[] => list.map((each) => each.name);
  assert.deepEqual(offered(propertyCompletion, "p {\n  font-s"), names(SUBSET.properties));
  // An `@page` body declares the page's own properties and opens the
  // margin boxes the engine draws, and no box it drops.
  const page = offered(propertyCompletion, "@page :left {\n  mar");
  assert.deepEqual(page?.slice(0, SUBSET.page.properties.length), names(SUBSET.page.properties));
  assert.ok(page?.includes("@top-center"));
  assert.ok(!page?.includes("@left-middle"));
  assert.ok(offered(propertyCompletion, "@page {\n  @bottom-center {\n    cont")?.includes("content"));
  assert.deepEqual(
    offered(propertyCompletion, "@font-face {\n  sr"),
    names(SUBSET.font_face.descriptors),
  );
  // A value, a selector and a block the engine does not read offer no name.
  assert.equal(offered(propertyCompletion, "p {\n  color: re"), undefined);
  assert.equal(offered(propertyCompletion, "p"), undefined);
  assert.equal(offered(propertyCompletion, "@media print {\n  co"), undefined);
});

test("the values of the property at the caret complete", () => {
  assert.deepEqual(offered(valueCompletion, "p {\n  font-style: "), [
    "normal",
    "italic",
    "oblique",
    "var()",
  ]);
  assert.ok(offered(valueCompletion, "p {\n  color: re")?.includes("rebeccapurple"));
  assert.ok(offered(valueCompletion, "p {\n  font-family: Junicode, s")?.includes("serif"));
  const size = offered(valueCompletion, "@page {\n  size: ");
  assert.ok(size?.includes("a5") && size.includes("landscape"));
  const content = offered(valueCompletion, "@page {\n  @top-center {\n    content: ");
  assert.ok(content?.includes("counter()") && content.includes("upper-roman"));
  // A hex colour and a number's unit are not keywords.
  assert.equal(offered(valueCompletion, "p {\n  color: #ff"), undefined);
  assert.equal(offered(valueCompletion, "p {\n  font-size: 1.5e"), undefined);
  // A property the engine does not set has no values to offer.
  assert.equal(offered(valueCompletion, "p {\n  text-wrap: "), undefined);
});

test("a completion carries its syntax as detail, under the label rather than beside the list", () => {
  const state = editing("p {\n  font-s");
  const options = propertyCompletion(new CompletionContext(state, state.doc.length, false))?.options;
  const size = options?.find((option) => option.label === "font-size");
  assert.equal(size?.detail, SUBSET.properties.find((each) => each.name === "font-size")?.syntax);
  assert.equal(size?.info, undefined);
});

test("a name inside var() completes from the custom properties the sheet declares", () => {
  const sheet = ":root {\n  --accent: teal;\n  /* --hidden: red; */\n}\np {\n  color: var(--a";
  assert.deepEqual(offered(namedCompletion, sheet), ["--accent"]);
  // Inside var() the property's own keywords give way to the names.
  assert.equal(offered(valueCompletion, sheet), undefined);
  assert.equal(offered(namedCompletion, "p {\n  color: re"), undefined);
});

test("a name inside string() completes from the names the sheet's string-set declarations set", () => {
  const sheet =
    'h1 {\n  string-set: chapter content(), part "a, b";\n}\nh2 { string-set: none; }\n' +
    "@page {\n  @top-center {\n    content: string(";
  assert.deepEqual(offered(namedCompletion, sheet), ["chapter", "part"]);
  assert.equal(offered(valueCompletion, sheet), undefined);
});

test("a selector completes from the ids and the classes the book's sections carry", () => {
  const selector = (doc: string, at?: number): string[] | undefined =>
    offered(selectorCompletion, doc, at);
  // A class is a role some section has, each once, and an id is each section's.
  assert.deepEqual(selector("section."), [".title-page", ".chapter"]);
  assert.deepEqual(selector("p { a: b }\n#the"), ["#title-page", "#the-harbor", "#the-lighthouse"]);
  assert.deepEqual(selector("h1, .ch"), [".title-page", ".chapter"]);
  // Inside a rule's braces a `#` starts a colour, not a selector, closed or not.
  assert.equal(selector("p {\n  color: #ff\n}", "p {\n  color: #ff".length), undefined);
  assert.equal(selector("p {\n  color: #ff"), undefined);
  assert.equal(selector("@page {\n  @top-left { content: #x"), undefined);
  assert.equal(selector("/* .ch"), undefined);
});

test("a selector completes the elements, pseudo-classes and at-rules the engine reads", () => {
  const selector = (doc: string): string[] | undefined => offered(selectorCompletion, doc);
  assert.deepEqual(selector("h"), SUBSET.selectors.elements);
  assert.ok(selector("p:first")?.includes(":first-child"));
  assert.deepEqual(
    selector("p::"),
    SUBSET.selectors.pseudo_elements.map(({ name }) => name),
  );
  assert.deepEqual(selector("@"), ["@page", "@font-face"]);
  assert.deepEqual(
    selector("@page :"),
    SUBSET.page.selectors.map((name) => `:${name}`),
  );
  // An at-rule opens a statement, and a page name is not an element.
  assert.equal(selector("p @"), undefined);
  assert.equal(selector("@page ch"), undefined);
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
// Obsidian and waits on the write, the render, the squiggle and its
// card. Nor the font the engine carries, which no face registers and
// the completion does not offer.
//
// The completion reads the engine's subset for names and keywords,
// not its grammar. It offers no value inside a function, except the
// names inside `var()` and `string()` and the counter styles that a
// `content` value takes anywhere, and no unit
// after a number. It does not offer `!important`, a page name
// after `@page`, or a class the author's own markdown writes. No e2e
// spec opens the completion list in Obsidian, so the Tab key that
// takes an option, the detail line under a label and the Obsidian icon
// beside it go untested.
