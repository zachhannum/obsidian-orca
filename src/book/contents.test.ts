import assert from "node:assert/strict";
import { test } from "node:test";
import { contentsMarkdown, firstHeading } from "@/book/contents";

test("a note's first heading skips its frontmatter and its fenced code", () => {
  assert.equal(
    firstHeading("---\ntitle: # Not this\n---\n\n```\n# nor this\n```\n\n## Chapter One ##\n\n# Later"),
    "Chapter One",
  );
  assert.equal(firstHeading("~~~md\n# fenced\n~~~\n# Out"), "Out");
  assert.equal(firstHeading("#hashtag\n\nNo heading here."), undefined);
  assert.equal(firstHeading("---\ntitle: Empty\n---\n"), undefined);
});

test("each entry links to its note's heading, and one with no heading links to the note", () => {
  assert.equal(
    contentsMarkdown("Contents", [
      {
        label: "Chapter One: Mr. Bennet's [first] (visit)",
        path: "Book/Chapters/Chapter One.md",
        heading: "Chapter One: Mr. Bennet's [first] (visit)",
      },
      { label: "Interlude", path: "Interlude.md" },
    ]),
    "# Contents\n\n" +
      "[Chapter One: Mr. Bennet's \\[first\\] (visit)]" +
      "(Book/Chapters/Chapter%20One.md#Chapter%20One%3A%20Mr.%20Bennet%27s%20%5Bfirst%5D%20%28visit%29)" +
      "\n\n[Interlude](Interlude.md)",
  );
  assert.equal(contentsMarkdown("Contents", []), "# Contents");
});

// What this tier does not cover: the page a link lands on, which the
// engine prints and plan.test.ts sets, and a setext heading, which
// firstHeading does not read.
