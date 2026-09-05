import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { readFrontmatter } from "@/book/frontmatter";
import { pathLinks } from "@/book/links";
import {
  add,
  entries,
  entryName,
  readOrder,
  remove,
  resolve,
  writeOrder,
  type Order,
  type Section,
} from "@/book/order";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

async function body(): Promise<string> {
  return readFrontmatter(await readText(vault, BOOK)).body;
}

async function order(): Promise<Order> {
  return readOrder(await body());
}

async function paths(): Promise<string[]> {
  return (await vault.list("/")).files;
}

/** The path of every section that has a note. */
function found(sections: Section[]): string[] {
  return sections.flatMap((section) =>
    section.kind === "note" ? [section.path] : [],
  );
}

test("an entry's role comes from its heading, and an inline code tag overrides it", async () => {
  const all = entries(await order());

  assert.deepEqual(
    all.map((entry) => [entryName(entry), entry.role]),
    [
      ["Title page", "title-page"],
      ["Copyright", "copyright"],
      ["A note on the text", "epigraph"],
      ["Contents", "contents"],
      ["Volume the First", "part"],
      ["Chapter Twelve", "chapter"],
      ["Chapter Four", "chapter"],
      ["Acknowledgements", "back-matter"],
    ],
  );

  // The same link under another heading is another role, which is what
  // dragging an entry across a heading does.
  const moved = entries(readOrder("\n# Back matter\n\n- [[Chapter Twelve]]\n"));
  assert.deepEqual(moved.map((entry) => entry.role), ["back-matter"]);
});

test("a book note's reading order parsed and written back is byte-identical", async () => {
  const text = await body();
  assert.equal(writeOrder(readOrder(text)), text);

  // A body orca does not read is kept as it was written.
  for (const kept of [
    "\n\n# Body\n\n- [[Chapter Twelve]]\n\nA line of the author's own.\n\n```css\n.chapter { margin: 0 }\n```\n",
    "\n\n- [[Chapter Twelve]]\n- not an entry\n- [[Chapter Four]] `prologue`\n",
    "",
  ]) {
    assert.equal(writeOrder(readOrder(kept)), kept);
  }
});

test("a renamed or moved chapter keeps its entry, and orca writes nothing", async () => {
  const text = await body();
  const book = readOrder(text);
  const before = await paths();

  // The link is resolved whenever the file is wanted, so a note that
  // moved to another folder is found in its new one.
  const moved = before.map((at) =>
    at === "Chapter Twelve.md" ? "Volume the First/Chapter Twelve.md" : at,
  );
  assert.ok(
    found(resolve(book, pathLinks(moved), BOOK).sections).includes(
      "Volume the First/Chapter Twelve.md",
    ),
  );

  // Obsidian rewrites the link on a rename. The entry keeps its place,
  // its role and its heading, and orca rewrites nothing itself.
  const renamed = readOrder(text.replace("[[Chapter Twelve]]", "[[Chapter XII]]"));
  assert.deepEqual(
    entries(renamed).map((entry) => [entry.role, entry.heading]),
    entries(book).map((entry) => [entry.role, entry.heading]),
  );
  assert.equal(writeOrder(book), text);
  assert.deepEqual(await paths(), before);
});

test("a book borrows its notes: adding never copies, removing never deletes", async () => {
  const book = await order();
  const before = await paths();

  const grown = add(book, "Chapter Thirteen", "Body");
  assert.deepEqual(entries(grown).map(entryName).slice(4), [
    "Volume the First",
    "Chapter Twelve",
    "Chapter Four",
    "Chapter Thirteen",
    "Acknowledgements",
  ]);
  assert.match(writeOrder(grown), /- \[\[Chapter Four\]\]\n- \[\[Chapter Thirteen\]\]\n/);

  // The same note sits in a second book, whose body is one link and
  // nothing else.
  const second = add(readOrder("\n"), "Chapter Twelve", "Body");
  const links = pathLinks(before);
  assert.deepEqual(found(resolve(second, links, "The Bennet Novels.md").sections), [
    "Chapter Twelve.md",
  ]);

  const shrunk = remove(grown, 5);
  assert.ok(!entries(shrunk).map(entryName).includes("Chapter Twelve"));
  assert.equal(await vault.exists("Chapter Twelve.md"), true);
  assert.deepEqual(await paths(), before);
});

test("a note that is gone keeps its entry, and the rest of the book is set without it", async () => {
  const book = await order();

  const { sections, warnings } = resolve(book, pathLinks(await paths()), BOOK);

  const missing = sections.flatMap((section) =>
    section.kind === "missing" ? [entryName(section.entry)] : [],
  );
  assert.deepEqual(missing, ["Chapter Four"]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.entry, sections[6]?.entry);
  assert.match(String(warnings[0]?.said), /Chapter Four/);

  // Every other section still has its note, and the generated two need
  // none.
  assert.deepEqual(found(sections), [
    "Copyright.md",
    "A note on the text.md",
    "Volume the First.md",
    "Chapter Twelve.md",
    "Acknowledgements.md",
  ]);
  assert.deepEqual(
    sections.flatMap((section) =>
      section.kind === "generated" ? [entryName(section.entry)] : [],
    ),
    ["Title page", "Contents"],
  );

  // The entry is still in the note after a write, for the author to
  // locate or remove.
  assert.match(writeOrder(book), /- \[\[Chapter Four\]\]/);
});

// What this tier does not cover: the navigator, which renders a
// missing entry in place with `Locate` and `Remove` and re-roles an
// entry on a drag, and the crossing to the engine, which is the op
// planner's and waits on the theme.
