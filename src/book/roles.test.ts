import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ROLE, ROLES, roleOf, type Origin } from "@/book/roles";

/** The roles the format has, and whether a section in each comes from a note. */
const TABLE: Readonly<Record<string, Origin>> = {
  "title-page": "generated",
  copyright: "note",
  dedication: "note",
  epigraph: "note",
  contents: "generated",
  "front-matter": "note",
  part: "note",
  chapter: "note",
  "back-matter": "note",
};

test("every role resolves, and a generated one has no note behind it", () => {
  assert.deepEqual(Object.keys(ROLES), Object.keys(TABLE));

  for (const [tag, origin] of Object.entries(TABLE)) {
    const role = roleOf(tag);
    assert.ok(role !== undefined, tag);
    assert.equal(role, tag);
    assert.equal(ROLES[role].origin, origin);
    assert.notEqual(ROLES[role].name, "");
  }
  assert.equal(roleOf("prologue"), undefined);
  // An entry names its own role or takes the default. A heading names
  // none: it groups the entries and nothing else.
  assert.equal(roleOf(DEFAULT_ROLE), DEFAULT_ROLE);
});

// What this tier does not cover: the CSS each role generates, and the
// folios, running heads and page breaks a role sets, which are the
// style module's and wait on M2.
