import assert from "node:assert/strict";
import test from "node:test";
import { FRONTMATTER, notes } from "@/book/dialect";

/** Every node name the parse gives, innermost last, in document order. */
function named(text: string): string[] {
  const found: string[] = [];
  notes.parse(text).iterate({
    enter(node) {
      found.push(node.name);
    },
  });
  return found;
}

/** The nodes of one name, as the text they cover. */
function covered(text: string, name: string): string[] {
  const found: string[] = [];
  notes.parse(text).iterate({
    enter(node) {
      if (node.name === name) found.push(text.slice(node.from, node.to));
    },
  });
  return found;
}

test("a frontmatter block at the top of the file is not prose", () => {
  const text = "---\ntitle: One\n---\n\nA paragraph.\n";
  assert.deepEqual(covered(text, FRONTMATTER), ["---\ntitle: One\n---"]);
  assert.deepEqual(covered(text, "Paragraph"), ["A paragraph."]);
});

test("three dashes below the top of the file are not frontmatter", () => {
  const text = "A paragraph.\n\n---\n\nAnother.\n";
  assert.deepEqual(covered(text, FRONTMATTER), []);
  assert.ok(named(text).includes("HorizontalRule"));
});

test("a frontmatter block that never closes is read as prose", () => {
  const text = "---\ntitle: One\n\nA paragraph.\n";
  assert.deepEqual(covered(text, FRONTMATTER), []);
});

test("a line of dashes under text is a setext heading, not frontmatter", () => {
  const text = "A title\n---\n\nA paragraph.\n";
  assert.deepEqual(covered(text, FRONTMATTER), []);
  assert.deepEqual(covered(text, "SetextHeading2"), ["A title\n---"]);
});

test("a table is a block of its own", () => {
  const text = "| a | b |\n| - | - |\n| 1 | 2 |\n";
  assert.ok(named(text).includes("Table"));
});

test("a task list item is a block of its own", () => {
  const text = "- [ ] one\n- [x] two\n";
  assert.ok(named(text).includes("TaskMarker"));
});

test("strikethrough is read", () => {
  assert.ok(named("~~gone~~\n").includes("Strikethrough"));
});

test("a fenced block holds its text rather than parsing it", () => {
  const text = "```\n{#one}\n```\n";
  assert.deepEqual(covered(text, "Paragraph"), []);
  assert.ok(named(text).includes("FencedCode"));
});

test("a block indented four spaces is code", () => {
  const text = "A paragraph.\n\n    {#one}\n";
  assert.deepEqual(covered(text, "CodeBlock"), ["{#one}"]);
});

// What this file does not cover: footnote definitions, which fleuron
// reads as blocks and this parser reads as paragraphs, and wikilinks,
// which are inline and move no block boundary. The property test
// beside `marks.ts` is what holds this parse against the engine's.
