import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ROLE, ROLES, bodyStart, customOf, roleOf, type Origin } from "@/book/roles";

/** The roles the format has, and whether a section in each comes from a note. */
const TABLE: Readonly<Record<string, Origin>> = {
  "title-page": "generated",
  copyright: "note",
  dedication: "note",
  epigraph: "note",
  contents: "generated",
  matter: "note",
  part: "note",
  chapter: "note",
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

test("each role states its effect in one line, and a generated one says a linked note is not set", () => {
  for (const [role, { origin, effect }] of Object.entries(ROLES)) {
    assert.match(effect, /^\S.*\.$/, role);
    assert.equal(effect.includes("A linked note is not set."), origin === "generated", role);
  }
});

test("a tag that names no role is a name of the author's own, when a selector can write it", () => {
  assert.equal(customOf("prologue"), "prologue");
  assert.equal(customOf(" half-title "), "half-title");
  // The format has one role for front and back matter, so either word is a name.
  assert.equal(customOf("back-matter"), "back-matter");
  // A role is not a name, and neither is a word a class selector cannot write.
  assert.equal(customOf("chapter"), undefined);
  for (const tag of ["", "Two Words", "Prologue", "2nd", "a.b"]) assert.equal(customOf(tag), undefined, tag);
});

test("the body starts at the first part or chapter, and a book with neither has none", () => {
  assert.equal(bodyStart(["title-page", "matter", "part", "chapter"]), 2);
  assert.equal(bodyStart(["chapter", "matter"]), 0);
  assert.equal(bodyStart(["title-page", "copyright"]), undefined);
});

// What this tier does not cover: the CSS each role generates, and the
// folios, running heads and page breaks a role sets, which are the
// style module's. Nor how a picker draws the line, which the e2e run
// reads.
