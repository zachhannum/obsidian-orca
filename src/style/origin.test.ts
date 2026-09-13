import assert from "node:assert/strict";
import { test } from "node:test";
import { readOrigin } from "@/style/origin";

test("a warning's origin is read from the right, so a name with a colon keeps it", () => {
  assert.deepEqual(readOrigin("book.css:8:3"), { sheet: "book.css", line: 8, column: 3 });
  assert.deepEqual(readOrigin("orca-generated:0:1:1"), {
    sheet: "orca-generated:0",
    line: 1,
    column: 1,
  });
  assert.equal(readOrigin("book.css"), undefined);
  assert.equal(readOrigin("book.css:x:3"), undefined);
  assert.equal(readOrigin(":8:3"), undefined);
});

// What this tier does not cover: the origins a real render reports,
// which the sheet tests set through the engine.
