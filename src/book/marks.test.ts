import assert from "node:assert/strict";
import test from "node:test";
import { marksIn, namesOf } from "@/book/marks";

/** Each mark as its form and the text it covers, which is what a chip replaces. */
function drawn(text: string): string[] {
  return marksIn(text).map((mark) => `${mark.form} ${JSON.stringify(text.slice(mark.from, mark.to))}`);
}

test("a paragraph of one brace run is an attribute line", () => {
  assert.deepEqual(drawn("{#opening .epigraph}\n\nA paragraph.\n"), [
    'line "{#opening .epigraph}"',
  ]);
});

test("a brace run written inside a paragraph is prose", () => {
  assert.deepEqual(drawn("A paragraph {#opening} and more.\n"), []);
});

test("a brace run inside a fenced block is the code it is", () => {
  assert.deepEqual(drawn("```\n{#opening}\n```\n"), []);
  assert.deepEqual(drawn("~~~\n{#opening}\n~~~\n"), []);
});

test("a brace run indented four spaces is the code it is", () => {
  assert.deepEqual(drawn("A paragraph.\n\n    {#opening}\n"), []);
});

test("a brace run inside frontmatter is metadata", () => {
  assert.deepEqual(drawn("---\ntitle: {#opening}\n---\n\nA paragraph.\n"), []);
});

test("a brace run inside a table cell is prose", () => {
  assert.deepEqual(drawn("| a | b |\n| - | - |\n| {#one} | 2 |\n"), []);
});

test("a heading takes the run written after it", () => {
  assert.deepEqual(drawn("# Chapter One {.opening}\n"), ['heading " {.opening}"']);
});

test("an image alone on its line takes the run written after it", () => {
  assert.deepEqual(drawn("![Plate](plate.png){.full}\n"), ['image "{.full}"']);
});

test("a run after an image inside a sentence is prose", () => {
  assert.deepEqual(drawn("See ![Plate](plate.png){.full} here.\n"), []);
});

test("a bracketed run closed by a brace is a span", () => {
  assert.deepEqual(drawn("She said [no]{.spoken} again.\n"), ['span "{.spoken}"']);
});

test("a bracketed run with a blank before the brace is prose", () => {
  assert.deepEqual(drawn("She said [no] {.spoken} again.\n"), []);
});

test("a span inside inline code is the code it is", () => {
  assert.deepEqual(drawn("Type `[no]{.spoken}` here.\n"), []);
});

test("a setext heading is drawn at the level of its underline", () => {
  assert.deepEqual(drawn("Chapter One\n===\n"), ['setext "==="']);
  assert.deepEqual(drawn("Chapter One\n---\n"), ['setext "---"']);
});

test("a brace run over a row of dashes names the scene break under it", () => {
  assert.deepEqual(drawn("A paragraph.\n\n{.scene}\n---\n"), ['line "{.scene}"']);
});

test("a run that names neither an id nor a class is drawn as it was written", () => {
  const [mark] = marksIn("{opening}\n");
  assert.equal(mark?.form, "line");
  assert.deepEqual(mark?.names, { id: undefined, classes: [], said: "opening" });
});

test("a run names one id and every class in written order", () => {
  assert.deepEqual(namesOf("#one .two .three"), {
    id: "one",
    classes: ["two", "three"],
    said: "#one .two .three",
  });
});

test("a run of two ids is one fleuron cannot use", () => {
  assert.deepEqual(namesOf("#one #two"), { id: undefined, classes: [], said: "#one #two" });
});

test("the marks of a note come back in written order", () => {
  const text = "{#one}\n\n# Two {.three}\n\nFour [five]{.six}.\n";
  assert.deepEqual(drawn(text), ['line "{#one}"', 'heading " {.three}"', 'span "{.six}"']);
});

// What this file does not cover: `\pagebreak` and `\columnbreak`,
// which issue 169 draws, and footnote definitions, which fleuron reads
// as blocks and this parse reads as paragraphs. The property test
// against the engine is what holds the two parses together.
