import assert from "node:assert/strict";
import { test } from "node:test";
import { hyphenating } from "@/ui/language";

test("the panel names the language hyphenation will actually use", () => {
  const said = hyphenating("en-GB");
  assert.match(said, /English/);
  assert.match(said, /en-GB/);
  assert.match(hyphenating("de"), /German \(de\)/);
});

test("a book that sets no language is hyphenated as English, and the panel says so", () => {
  assert.match(hyphenating(undefined), /English/);
  assert.match(hyphenating(undefined), /until the book sets a language/);
});

test("a tag the platform cannot name is shown as the author wrote it", () => {
  assert.equal(hyphenating("zzz-nowhere"), "using zzz-nowhere");
});

// What this tier does not cover: the patterns themselves. That a
// language reaches the engine at all is `book/metadata.test.ts`, which
// reads the language back out of an exported PDF.
