import assert from "node:assert/strict";
import { test } from "node:test";
import { readFrontmatter } from "@/book/frontmatter";
import {
  DESIGN_FORMAT,
  DESIGN_KEY,
  applyDesignNote,
  designFormat,
  designNoteText,
  readDesignNote,
  writeDesignNote,
} from "@/book/design";
import { mergeDesign, readDesign, writeDesign } from "@/style/design";

test("a design note is a note whose frontmatter is a design and whose body is not a reading order", () => {
  const design = readDesign({ face: "Alegreya", leading: "14pt", orphans: 2 });

  const text = designNoteText(design, "\nThe house design.\n");
  const { properties, body } = readFrontmatter(text);

  assert.equal(designFormat(properties), DESIGN_FORMAT);
  assert.equal(properties[DESIGN_KEY], DESIGN_FORMAT);
  assert.deepEqual(readDesignNote(properties).design, design);
  assert.equal(body, "\nThe house design.\n");
});

test("a design note keeps the author's own properties and reads none of them", () => {
  const note = readDesignNote({
    [DESIGN_KEY]: 1,
    face: "Alegreya",
    tags: ["design"],
    status: "settled",
  });

  assert.deepEqual(note.own, { tags: ["design"], status: "settled" });
  assert.equal(note.design.text.face, "Alegreya");
  assert.deepEqual(writeDesignNote(note), {
    [DESIGN_KEY]: DESIGN_FORMAT,
    face: "Alegreya",
    tags: ["design"],
    status: "settled",
  });
});

test("a field the design no longer sets is taken out of the note it was written in", () => {
  const properties = { [DESIGN_KEY]: 1, face: "Alegreya", leading: "14pt" };

  applyDesignNote(properties, readDesign({ face: "EB Garamond" }));

  assert.deepEqual(properties, { [DESIGN_KEY]: 1, face: "EB Garamond" });
});

test("the design a book renders under is the shared note's, with the book's own keys over it", () => {
  const shared = readDesignNote({
    [DESIGN_KEY]: 1,
    face: "EB Garamond",
    leading: "14pt",
    orphans: 3,
  });
  const own = readDesign({ leading: "15pt" });

  const merged = mergeDesign(shared.design, own);

  assert.deepEqual(writeDesign(merged), {
    face: "EB Garamond",
    leading: "15pt",
    orphans: 3,
  });
});

// What this tier does not cover: resolving the link a book points at,
// which reads a second note and belongs to `ui`.
