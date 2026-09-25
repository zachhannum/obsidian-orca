import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, type Model } from "@/book/model";
import type { Cached } from "@/ui/outline";
import { members, shelve, type Shelving } from "@/ui/shelf";

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
  return { links: pathLinks([...paths, SECOND]), active };
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
  // The sections are the note's own headings, in the order it has them.
  assert.deepEqual(
    shelf.groups.map((group) => group.heading),
    ["Front matter", "Body", "Back matter", "The book's css"],
  );
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
      [7, "Chapter Fifteen", "note"],
      [8, "Acknowledgements", "note"],
    ],
  );
  // A chip says the role, and the default role is not worth saying.
  assert.deepEqual(
    rows.filter((row) => row.named).map((row) => row.role),
    [
      "title-page",
      "copyright",
      "epigraph",
      "contents",
      "part",
      "back-matter",
    ],
  );
  assert.deepEqual(
    rows.filter((row) => !row.named).map((row) => row.name),
    ["Chapter Twelve", "Chapter Four", "Chapter Fifteen"],
  );
});

test("the headings come from the cache the navigator is handed, and nothing is read for them", async () => {
  const book = { path: BOOK, name: "Pride and Prejudice", model: await model() };
  const asked: string[] = [];
  const cache = (path: string): Cached[] | undefined => {
    asked.push(path);
    if (path !== "Chapter Fifteen.md") return undefined;
    return [
      { heading: "Chapter Fifteen", level: 1, position: { start: { line: 6 } } },
      { heading: "The Parsonage", level: 1, position: { start: { line: 13 } } },
    ];
  };
  const rows = shelve(book, { ...(await shelving(undefined)), headings: cache })
    .groups.flatMap((group) => group.rows);

  // Every note the book reads is asked about by its path.
  assert.deepEqual(asked, rows.flatMap((row) => row.path ?? []));
  const fifteen = rows.find((row) => row.name === "Chapter Fifteen");
  assert.deepEqual(fifteen?.headings, [{ line: 13, words: "The Parsonage", depth: 0, trail: [{ words: "The Parsonage", nth: 0 }] }]);

  // With no cache handed over, the rows list no headings at all.
  const bare = shelve(book, await shelving(undefined)).groups.flatMap((group) => group.rows);
  assert.ok(bare.every((row) => row.headings === undefined));
});

test("a heading renamed in a note the book reads changes the shelf the navigator compares", async () => {
  const book = { path: BOOK, name: "Pride and Prejudice", model: await model() };
  const cached = (words: string) => (path: string): Cached[] | undefined =>
    path === "Chapter Fifteen.md"
      ? [{ heading: words, level: 2, position: { start: { line: 22 } } }]
      : undefined;
  const vault = await shelving(undefined);
  const before = shelve(book, { ...vault, headings: cached("The Entail") });
  const after = shelve(book, { ...vault, headings: cached("The Settlement") });
  assert.notEqual(JSON.stringify(before), JSON.stringify(after));

  // A cache change in a note the book reads is one the navigator hears.
  const read = members([before]);
  assert.ok(read.has("Chapter Fifteen.md"));
  assert.ok(!read.has("Unlisted.md"));
});

// What this tier does not cover: the markup the navigator draws from
// this, the drag that moves a row, and a book from a newer orca, which
// the shelf leaves out rather than listing unread.
