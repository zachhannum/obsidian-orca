import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, type Model } from "@/book/model";
import { shelve, type Shelving } from "@/ui/shelf";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault, and a second book beside it. */
const BOOK = "Pride and Prejudice.md";
const SECOND = "The Bennet Novels.md";

async function model(): Promise<Model> {
  return readModel(await readText(vault, BOOK));
}

async function shelving(active: string | undefined): Promise<Shelving> {
  const paths = (await vault.list("/")).files;
  return { paths, links: pathLinks([...paths, SECOND]), active };
}

test("the navigator highlights the book the active note is in, and both books when it is in two", async () => {
  const book = { path: BOOK, name: "Pride and Prejudice", model: await model() };
  const second = {
    path: SECOND,
    name: "The Bennet Novels",
    model: readModel("---\norca-book: 1\n---\n\n# Body\n\n- [[Chapter Twelve]]\n"),
  };

  const on = await shelving("Chapter Twelve.md");
  assert.equal(shelve(book, on).holds, true);
  assert.equal(shelve(second, on).holds, true);

  // A note neither book reads highlights neither, and the book note
  // itself is one of the book's own.
  const away = await shelving("Chapter Nine.md");
  assert.equal(shelve(book, away).holds, false);
  assert.equal(shelve(second, away).holds, false);
  assert.equal(shelve(book, await shelving(BOOK)).holds, true);
  assert.equal(shelve(second, await shelving(BOOK)).holds, false);
});

test("a note that is gone keeps its row, and the row says the note is missing", async () => {
  const book = { path: BOOK, name: "Pride and Prejudice", model: await model() };

  const shelf = shelve(book, await shelving(undefined));

  const rows = shelf.groups.flatMap((group) => group.rows);
  assert.deepEqual(
    rows.filter((row) => row.kind === "missing").map((row) => row.name),
    ["Chapter Four"],
  );
  // Every row keeps the place its entry has in the reading order, so
  // `Locate` and `Remove` name the same entry the note does.
  assert.deepEqual(
    rows.map((row) => [row.at, row.name, row.kind]),
    [
      [0, "Title page", "generated"],
      [1, "Copyright", "note"],
      [2, "A note on the text", "note"],
      [3, "Contents", "generated"],
      [4, "Volume the First", "note"],
      [5, "Chapter Twelve", "note"],
      [6, "Chapter Four", "missing"],
      [7, "Acknowledgements", "note"],
    ],
  );
  // A new chapter is appended to the body, which is the group the
  // book opens its chapters with rather than the author's css heading.
  assert.equal(shelf.body, "Body");
  // The tagged entries are the ones the navigator draws a chip on.
  assert.deepEqual(
    rows.filter((row) => row.tagged).map((row) => row.role),
    ["title-page", "copyright", "epigraph", "contents", "part"],
  );
});

// What this tier does not cover: the markup the navigator draws from
// this, the drag that moves a row, and a book from a newer orca, which
// the shelf leaves out rather than listing unread.
