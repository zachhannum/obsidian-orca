import assert from "node:assert/strict";
import { test } from "node:test";
import { hyphenating } from "@/ui/language";

test("the panel names the language hyphenation will actually use", () => {
  assert.match(hyphenating("en-GB"), /English/);
  assert.equal(hyphenating("de"), "German");
});

test("a book that sets no language is hyphenated as English, and the panel says so", () => {
  assert.equal(hyphenating(undefined), "English (default)");
});

test("a tag the platform cannot name is shown as the author wrote it", () => {
  assert.equal(hyphenating("zzz-nowhere"), "zzz-nowhere");
});

// What this tier does not cover: the patterns themselves.
// `book/metadata.test.ts` checks that a language reaches the engine. It
// reads the language back out of an exported PDF.
