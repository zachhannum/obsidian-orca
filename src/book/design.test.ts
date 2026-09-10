import assert from "node:assert/strict";
import { test } from "node:test";
import { readFrontmatter, type Properties } from "@/book/frontmatter";
import {
  DESIGN_FORMAT,
  DESIGN_KEY,
  absorbed,
  applyDesignNote,
  bookDesign,
  designFormat,
  designNoteText,
  extracted,
  readDesignNote,
  writeDesignNote,
} from "@/book/design";
import { pathLinks } from "@/book/links";
import { FORMAT, type Book } from "@/book/note";
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

test("a book is set under the note it points at, with its own keys over it", async () => {
  const notes: Properties = {
    [DESIGN_KEY]: 1,
    face: "EB Garamond",
    leading: "14pt",
    orphans: 3,
  };
  const book = booked(readDesign({ leading: "15pt" }), "[[House design]]");

  const design = await bookDesign(book, "Books/Novel.md", links, {
    properties: (path) => Promise.resolve(path === "House design.md" ? notes : undefined),
  });

  assert.deepEqual(writeDesign(design), {
    face: "EB Garamond",
    leading: "15pt",
    orphans: 3,
  });
});

test("a link the vault cannot resolve leaves the book set under its own keys", async () => {
  const book = booked(readDesign({ leading: "15pt" }), "[[Nowhere]]");

  const design = await bookDesign(book, "Books/Novel.md", links, {
    properties: () => Promise.resolve(undefined),
  });

  assert.deepEqual(design, book.design);
});

test("`Extract design to a shared note` moves the design between the two notes", () => {
  const book = booked(readDesign({ face: "Alegreya", leading: "14pt" }));

  const shared = extracted(book, "[[House design]]");

  assert.deepEqual(writeDesign(shared.design), {});
  assert.equal(shared.designNote, "[[House design]]");

  const back = absorbed(shared, book.design);

  assert.equal(back.designNote, undefined);
  assert.deepEqual(writeDesign(back.design), {
    face: "Alegreya",
    leading: "14pt",
  });
});

const links = pathLinks(["Books/Novel.md", "House design.md"]);

function booked(design: ReturnType<typeof readDesign>, designNote?: string): Book {
  const book: Book = { format: FORMAT, metadata: {}, design, own: {} };
  if (designNote !== undefined) book.designNote = designNote;
  return book;
}

// What this tier does not cover: creating the shared note, which is a
// write to the vault and belongs to `ui`.
