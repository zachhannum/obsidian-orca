import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { readFrontmatter, writeFrontmatter } from "@/book/frontmatter";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

test("a note is its properties and the body under them", async () => {
  const note = readFrontmatter(await readText(vault, BOOK));

  assert.equal(note.properties["orca-book"], 1);
  assert.equal(note.properties["title"], "Pride and Prejudice");
  assert.equal(note.properties["language"], "en-GB");
  assert.match(note.body, /^\n\n# Front matter\n/);
  assert.ok(note.body.includes("\n- [[Acknowledgements]] `back-matter`\n"));
  assert.ok(note.body.endsWith("```css\n.chapter-opening h1 {\n  letter-spacing: 0.02em;\n}\n```\n"));
});

test("a note with no frontmatter is all body", () => {
  const chapter = "# Chapter Twelve\n\nIn consequence of an agreement.\n";

  assert.deepEqual(readFrontmatter(chapter), {
    properties: {},
    body: chapter,
  });
});

test("a scalar is read the way YAML reads it, quotes and all", () => {
  const { properties } = readFrontmatter(
    [
      "---",
      "hyphens: no",
      'language: "no"',
      "leading: 14",
      "tags:",
      "  - novel",
      "  - austen",
      "cover:",
      "---",
      "",
    ].join("\n"),
  );

  assert.deepEqual(properties, {
    hyphens: false,
    language: "no",
    leading: 14,
    tags: ["novel", "austen"],
    cover: null,
  });
});

test("a value a parser would read as something else is written quoted", () => {
  const text = writeFrontmatter(
    {
      properties: { title: "Pride and Prejudice", hyphens: "no", language: "en-GB" },
      body: "\n",
    },
    new Set(["language"]),
  );

  assert.equal(
    text,
    '---\ntitle: Pride and Prejudice\nhyphens: "no"\nlanguage: "en-GB"\n---\n',
  );
});

// What this tier does not cover: a comment inside the fence, a block
// scalar, and a nested map in an author's own property, whose keys are
// read as one empty property.
