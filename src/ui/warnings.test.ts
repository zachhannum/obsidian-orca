import assert from "node:assert/strict";
import { test } from "node:test";
import { GENERATED_ORIGIN } from "@/book/plan";
import { THEME_SHEET } from "@/style/theme";
import { isOrcas } from "@/ui/warnings";

const MESSAGE = "unsupported property `position`";

test("a warning against a generated section goes to the console, and one against a note is the author's", () => {
  assert.equal(isOrcas({ message: MESSAGE, origin: `${GENERATED_ORIGIN}:0:1:1` }), true);
  assert.equal(isOrcas({ message: MESSAGE, origin: `${THEME_SHEET}:2:3` }), true);
  assert.equal(isOrcas({ message: MESSAGE, origin: "Chapter Twelve.md:6:1" }), false);
  // A note may be named like the prefix, but no note name has its colon.
  assert.equal(isOrcas({ message: MESSAGE, origin: `${GENERATED_ORIGIN}.md:1:1` }), false);
  assert.equal(isOrcas({ message: MESSAGE, origin: null }), false);
});

// What this tier does not cover: the console itself, and the preview's
// warning cards, which the e2e suite reads.
