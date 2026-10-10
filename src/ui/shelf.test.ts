import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/testUtils/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, type Model } from "@/book/model";
import { HEADINGS_KEY } from "@/book/note";
import { listedFor } from "@/ui/limits";
import { levelsTo, type Cached } from "@/ui/outline";
import {
  filterShelf,
  members,
  readSort,
  shelve,
  sortShelf,
  type Shelved,
  type Shelving,
  visibleRows,
} from "@/ui/shelf";

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
      [2, "Dedication", "note"],
      [3, "A note on the text", "note"],
      [4, "Contents", "generated"],
      [5, "Preface", "note"],
      [6, "Volume the First", "note"],
      [7, "Chapter Twelve", "note"],
      [8, "Chapter Four", "missing"],
      [9, "Chapter Fifteen", "note"],
      [10, "Acknowledgements", "note"],
    ],
  );
  // A chip says the role, and the default role is not worth saying.
  assert.deepEqual(
    rows.filter((row) => row.named).map((row) => row.role),
    [
      "title-page",
      "copyright",
      "dedication",
      "epigraph",
      "contents",
      "matter",
      "part",
      "matter",
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

  // A book that hides its headings draws none, so the same change in
  // its notes is not one the navigator hears.
  const hidden = shelve(book, vault);
  assert.ok(hidden.groups.some((group) => group.rows.some((row) => row.path === "Chapter Fifteen.md")));
  assert.equal(members([hidden]).size, 0);
  assert.ok(members([hidden, before]).has("Chapter Fifteen.md"));
});

test("each book lists its headings down to its own level", async () => {
  const cache: Cached[] = [
    { heading: "Chapter Twelve", level: 1, position: { start: { line: 0 } } },
    { heading: "Netherfield", level: 2, position: { start: { line: 4 } } },
    { heading: "The Letter", level: 3, position: { start: { line: 9 } } },
  ];
  // The navigator hands each book a reader cut at the book's own level.
  const down = (deepest: number) => () => levelsTo(cache, deepest);
  const text = (own: number): string =>
    `---\norca-book: 1\n${HEADINGS_KEY}: ${String(own)}\n---\n\n# Body\n\n- [[Chapter Twelve]]\n`;
  const vault = await shelving(undefined);
  const shelf = [
    { path: BOOK, name: "Pride and Prejudice", own: 2 },
    { path: SECOND, name: "The Bennet Novels", own: 3 },
  ].map(({ path, name, own }) => {
    const model = readModel(text(own));
    const deepest = listedFor({ headings: false, deepest: 6 }, model.book.headings);
    assert.equal(deepest, own);
    return shelve(
      { path, name, model },
      { ...vault, headings: deepest === undefined ? undefined : down(deepest) },
    );
  });

  // Each book keeps the level its note holds, which its menu checks.
  assert.deepEqual(shelf.map((book) => book.headings), [2, 3]);
  // The same note is one row in each book, and each lists its own depth.
  assert.deepEqual(
    shelf.map((book) =>
      book.groups.flatMap((group) =>
        group.rows.flatMap((row) => (row.headings ?? []).map((heading) => heading.words)),
      ),
    ),
    [["Netherfield"], ["Netherfield", "The Letter"]],
  );
  // A book whose note holds no level carries none.
  assert.equal(shelve({ path: BOOK, name: "", model: await model() }, vault).headings, undefined);
});

function shelved(name: string, ...chapters: string[]): Shelved {
  return {
    path: `${name}.md`,
    name,
    folder: "",
    holds: false,
    groups: [
      {
        heading: "",
        rows: chapters.map((chapter, at) => ({
          at,
          name: chapter,
          kind: "note" as const,
          role: "chapter" as const,
          named: false,
        })),
      },
    ],
  };
}

test("the sort orders books by name, either way, and keeps vault order by default", () => {
  const shelf = [shelved("Zeta"), shelved("alpha"), shelved("Book 10"), shelved("Book 2")];
  const names = (order: Parameters<typeof sortShelf>[1]) =>
    sortShelf(shelf, order).map((book) => book.name);
  assert.deepEqual(names("vault"), ["Zeta", "alpha", "Book 10", "Book 2"]);
  assert.deepEqual(names("name"), ["alpha", "Book 2", "Book 10", "Zeta"]);
  assert.deepEqual(names("name-reverse"), ["Zeta", "Book 10", "Book 2", "alpha"]);
  assert.equal(readSort("name"), "name");
  assert.equal(readSort("bogus"), "vault");
});

test("the filter shows the matching chapters of a book, with the places they have in the note", () => {
  const shelf = [
    shelved("Emma", "Volume One", "Volume Two"),
    shelved("Persuasion", "Anne", "Captain Wentworth"),
    shelved("Other", "Nothing"),
  ];
  assert.equal(filterShelf(shelf, "  ").length, 3);
  assert.equal(visibleRows(shelf[0] as Shelved, "EMMA"), undefined);
  assert.deepEqual(filterShelf(shelf, "emma").map((book) => book.name), ["Emma"]);
  const went = filterShelf(shelf, "went");
  assert.deepEqual(went.map((book) => book.name), ["Persuasion"]);
  // The book is whole, and the row that shows is the second of the note.
  assert.equal(went[0]?.groups[0]?.rows.length, 2);
  assert.deepEqual([...(visibleRows(went[0], "went") ?? [])], [1]);
  assert.deepEqual(filterShelf(shelf, "zzz"), []);
});

// What this tier does not cover: the markup the navigator draws from
// this, the drag that moves a row, and a book from a newer orca, which
// the shelf leaves out rather than listing unread. The filter and sort
// are tested on built shelves, not on the fixture vault's own books.
