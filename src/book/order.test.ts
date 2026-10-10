import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/testUtils/directory";
import { readText } from "@/assets/vault";
import { readFrontmatter } from "@/book/frontmatter";
import { linksIn, pathLinks } from "@/book/links";
import { newBook } from "@/book/create";
import {
  add,
  addGenerated,
  addGroup,
  entries,
  entryName,
  groups,
  insert,
  move,
  moveGroup,
  readOrder,
  remove,
  removeGroup,
  rename,
  renameGroup,
  resolve,
  retag,
  defaultHeading,
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

test("an entry's role is its own tag, and a heading names none", async () => {
  const all = entries(await order());

  assert.deepEqual(
    all.map((entry) => [entryName(entry), entry.role]),
    [
      ["Title page", "title-page"],
      ["Copyright", "copyright"],
      ["Dedication", "dedication"],
      ["A note on the text", "epigraph"],
      ["Contents", "contents"],
      ["Preface", "front-matter"],
      ["Volume the First", "part"],
      ["Chapter Twelve", "chapter"],
      ["Chapter Four", "chapter"],
      ["Chapter Fifteen", "chapter"],
      ["Acknowledgements", "back-matter"],
    ],
  );

  // The heading is organisational: an untagged entry takes the default
  // role wherever the note puts it.
  const under = entries(readOrder("\n# Back matter\n\n- [[Chapter Twelve]]\n"));
  assert.deepEqual(under.map((entry) => entry.role), ["chapter"]);
});

test("a book note's reading order parsed and written back is byte-identical", async () => {
  const text = await body();
  assert.equal(writeOrder(readOrder(text)), text);

  // A body orca does not read is kept as it was written.
  for (const kept of [
    "\n\n# Body\n\n- [[Chapter Twelve]]\n\nA line of the author's own.\n\n```css\n.chapter { margin: 0 }\n```\n",
    "\n\n- [[Chapter Twelve]]\n- not an entry\n- [[Chapter Four]] `Not A Name`\n- `prologue`\n",
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
  assert.deepEqual(entries(grown).map(entryName).slice(6), [
    "Volume the First",
    "Chapter Twelve",
    "Chapter Four",
    "Chapter Fifteen",
    "Chapter Thirteen",
    "Acknowledgements",
  ]);
  assert.match(writeOrder(grown), /- \[\[Chapter Fifteen\]\]\n- \[\[Chapter Thirteen\]\]\n/);

  // The same note sits in a second book, whose body is one link and
  // nothing else.
  const second = add(readOrder("\n"), "Chapter Twelve", "Body");
  const links = pathLinks(before);
  assert.deepEqual(found(resolve(second, links, "The Bennet Novels.md").sections), [
    "Chapter Twelve.md",
  ]);

  const shrunk = remove(grown, 7);
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
  assert.equal(warnings[0]?.entry, sections[8]?.entry);
  assert.match(String(warnings[0]?.said), /Chapter Four/);

  // Every other section still has its note, and the generated two need
  // none.
  assert.deepEqual(found(sections), [
    "Copyright.md",
    "Dedication.md",
    "A note on the text.md",
    "Preface.md",
    "Volume the First.md",
    "Chapter Twelve.md",
    "Chapter Fifteen.md",
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

test("every route into the list writes the same line, at the end of the body", async () => {
  const book = await order();

  // The quick pick and `Add to book` name the note; a paste names it
  // in the text the author copied. The three are one call.
  const picked = add(book, "Chapter Thirteen");
  const pasted = add(book, linksIn("meet me at [[Chapter Thirteen]] tonight")[0] ?? "");
  assert.equal(writeOrder(picked), writeOrder(pasted));
  assert.match(writeOrder(picked), /- \[\[Chapter Fifteen\]\]\n- \[\[Chapter Thirteen\]\]\n/);

  // The body is the group the book opens its chapters with, and not
  // the heading the author's css sits under.
  assert.deepEqual(
    entries(picked).map((entry) => entry.heading).slice(-3),
    ["Body", "Body", "Back matter"],
  );
});

test("a new chapter is appended at the end of its group, or dropped at a place in one", async () => {
  const book = await order();

  const appended = add(book, "Chapter Thirteen", "Front matter");
  assert.deepEqual(entries(appended).map(entryName).slice(0, 7), [
    "Title page",
    "Copyright",
    "Dedication",
    "A note on the text",
    "Contents",
    "Preface",
    "Chapter Thirteen",
  ]);
  // The section it landed in does not give it a role.
  assert.equal(entries(appended)[6]?.role, "chapter");

  const between = insert(book, "Chapter Thirteen", { heading: "Body", at: 1 });
  assert.deepEqual(entries(between).map(entryName).slice(6, 10), [
    "Volume the First",
    "Chapter Thirteen",
    "Chapter Twelve",
    "Chapter Four",
  ]);
});

test("a drag reorders the list, and an entry carries its role across a heading", async () => {
  const book = await order();

  // Inside a group, the entry lands where it was dropped.
  const later = move(book, 7, { heading: "Body", at: 3 });
  assert.deepEqual(entries(later).map(entryName).slice(6, 9), [
    "Volume the First",
    "Chapter Four",
    "Chapter Twelve",
  ]);

  // Across one, the entry keeps the role it had. A section groups the
  // reading order and says nothing about what is in it.
  const across = move(book, 3, { heading: "Body", at: 0 });
  const moved = entries(across)[5];
  assert.equal(moved?.link, "A note on the text");
  assert.equal(moved?.role, "epigraph");
  assert.equal(moved?.tag, "epigraph");
  assert.match(
    writeOrder(across),
    /# Body\n\n- \[\[A note on the text\]\] `epigraph`\n/,
  );

  // A role is the tag, and the default role is written as no tag.
  const tagged = retag(book, 8, "epigraph");
  assert.match(writeOrder(tagged), /- \[\[Chapter Four\]\] `epigraph`\n/);
  assert.equal(writeOrder(retag(tagged, 8, "chapter")), writeOrder(book));

  // Every group is a place to drop into, the empty ones included.
  assert.deepEqual(
    groups(book).map((group) => [group.heading, group.entries.length]),
    [
      ["Front matter", 6],
      ["Body", 4],
      ["Back matter", 1],
      ["The book's css", 0],
    ],
  );
});

test("a link tagged with a name that is no role is an entry under that name, set as prose from its note", async () => {
  const text = "\n\n- [[Chapter Twelve]]\n- [[Chapter Fifteen]] `prologue`\n";
  const book = readOrder(text);

  assert.deepEqual(
    entries(book).map(({ role, custom, tag }) => [role, custom, tag]),
    [
      ["chapter", undefined, undefined],
      ["front-matter", "prologue", undefined],
    ],
  );
  assert.equal(writeOrder(book), text);
  const [, section] = resolve(book, pathLinks(await paths()), BOOK).sections;
  assert.equal(section?.kind, "note");

  // A role takes the name away, and a name takes the role away.
  const named = rename(book, 0, "interlude");
  assert.match(writeOrder(named), /- \[\[Chapter Twelve\]\] `interlude`\n/);
  assert.equal(writeOrder(retag(named, 0, "chapter")), text);
  assert.match(writeOrder(rename(retag(book, 0, "epigraph"), 0, "interlude")), /- \[\[Chapter Twelve\]\] `interlude`\n/);
  assert.equal(writeOrder(retag(book, 1, "chapter")), "\n\n- [[Chapter Twelve]]\n- [[Chapter Fifteen]]\n");

  // The name moves with its entry.
  assert.equal(entries(move(book, 1, { heading: "", at: 0 }))[0]?.custom, "prologue");
});

test("a section is made, renamed, moved and taken out, and its entries stay", async () => {
  const book = await order();
  const headings = (found: Order): string[] =>
    groups(found).map((group) => group.heading);
  const named = (found: Order): [string, string][] =>
    entries(found).map((entry) => [entryName(entry), entry.heading]);

  const made = addGroup(book, "Appendices");
  assert.deepEqual(headings(made), [
    "Front matter",
    "Body",
    "Back matter",
    "The book's css",
    "Appendices",
  ]);

  // A rename is the heading's line and nothing else: the entries under
  // it keep their roles, because the heading never gave them one.
  const renamed = renameGroup(book, "Front matter", "Prelims");
  assert.deepEqual(headings(renamed), [
    "Prelims",
    "Body",
    "Back matter",
    "The book's css",
  ]);
  assert.deepEqual(
    entries(renamed).map((entry) => entry.role),
    entries(book).map((entry) => entry.role),
  );
  assert.equal(entries(renamed)[1]?.heading, "Prelims");

  // A section moves with everything under it.
  const moved = moveGroup(book, "Back matter", 0);
  assert.deepEqual(headings(moved), [
    "Back matter",
    "Front matter",
    "Body",
    "The book's css",
  ]);
  assert.deepEqual(named(moved).slice(0, 2), [
    ["Acknowledgements", "Back matter"],
    ["Title page", "Front matter"],
  ]);

  // Taking a section out takes its heading and nothing else. The
  // entries join the section above, in the places they already had.
  const gone = removeGroup(book, "Back matter");
  assert.deepEqual(headings(gone), ["Front matter", "Body", "The book's css"]);
  assert.deepEqual(entries(gone).map(entryName), entries(book).map(entryName));
  assert.equal(entries(gone).at(-1)?.heading, "Body");
  assert.equal(entries(gone).at(-1)?.role, "back-matter");
  // The heading takes one of its blank lines with it, so where it was
  // reads as one break rather than two.
  assert.equal(
    writeOrder(gone).includes(
      "- [[Chapter Fifteen]]\n\n- [[Acknowledgements]] `back-matter`\n\n# The book's css",
    ),
    true,
  );
});

test("removing an entry takes out its line and nothing else", async () => {
  const book = await order();
  const before = writeOrder(book);

  const after = writeOrder(remove(book, 7));

  assert.equal(after, before.replace("- [[Chapter Twelve]]\n", ""));
  assert.equal(await vault.exists("Chapter Twelve.md"), true);
});

test("a section moves to the last place among the groups", async () => {
  const book = await order();
  const headings = (found: Order): string[] =>
    groups(found).map((group) => group.heading);

  const moved = moveGroup(book, "Front matter", 3);

  assert.deepEqual(headings(moved), [
    "Body",
    "Back matter",
    "The book's css",
    "Front matter",
  ]);
  assert.deepEqual(
    entries(moved)
      .slice(-6)
      .map(entryName),
    [
      "Title page",
      "Copyright",
      "Dedication",
      "A note on the text",
      "Contents",
      "Preface",
    ],
  );

  // Prose above the first heading belongs to no group, so it stays at
  // the top of the note and counts in no group's place.
  const prose = readOrder("Some prose.\n\n# One\n\n- [[A]]\n\n# Two\n\n- [[B]]\n");
  assert.equal(
    writeOrder(moveGroup(prose, "One", 1)),
    "Some prose.\n\n# Two\n\n- [[B]]\n\n# One\n\n- [[A]]\n",
  );
});

test("an entry added at the end of an empty section keeps the note's last line", () => {
  const made = addGroup(readOrder("# Body\n\n- [[A]]\n"), "Appendices");

  const added = add(made, "B", "Appendices");

  assert.equal(
    writeOrder(added),
    "# Body\n\n- [[A]]\n\n# Appendices\n\n- [[B]]\n",
  );
});

test("a generated section is added by its role, and has no note to find", async () => {
  const book = await order();

  const made = addGenerated(book, "contents", "Back matter");

  const last = entries(made).at(-1);
  assert.equal(last?.link, undefined);
  assert.equal(last?.role, "contents");
  assert.equal(last?.heading, "Back matter");
  assert.equal(writeOrder(made).includes("- `contents`\n\n# The book's css"), true);

  const { sections, warnings } = resolve(made, pathLinks(await paths()), BOOK);
  assert.equal(sections.at(-1)?.kind, "generated");
  assert.equal(
    warnings.some((warning) => warning.entry.role === "contents"),
    false,
  );
});

test("a book with no chapters yet appends to its body", async () => {
  const made = newBook({}, []);

  const added = add(made.order, "Chapter One");

  assert.equal(defaultHeading(made.order), "Body");
  assert.equal(entries(added).at(-1)?.heading, "Body");
  // The group most of the book's chapters are in wins once there are
  // any, wherever in the note it sits.
  assert.equal(defaultHeading(added), "Body");

  const parts = readOrder(
    "# Body\n\n- [[A]]\n\n# Part One\n\n- [[B]]\n- [[C]]\n",
  );
  assert.equal(defaultHeading(parts), "Part One");
  // Two groups of a size are settled by the one the note has first.
  const tied = readOrder("# Body\n\n- [[A]]\n\n# Part One\n\n- [[B]]\n");
  assert.equal(defaultHeading(tied), "Body");
});

test("a section taken out takes one blank line with it, wherever it sits", () => {
  // The note opens on the heading, so there is no blank line above it
  // and the one below goes instead.
  const first = readOrder("# One\n\n- [[A]]\n\n# Two\n\n- [[B]]\n");
  assert.equal(
    writeOrder(removeGroup(first, "One")),
    "- [[A]]\n\n# Two\n\n- [[B]]\n",
  );

  // An empty group above it keeps its own heading and the line under it.
  const empty = readOrder("# One\n\n# Two\n\n- [[B]]\n");
  assert.equal(writeOrder(removeGroup(empty, "Two")), "# One\n\n- [[B]]\n");
});

// What this tier does not cover: the navigator, which renders a
// missing entry in place and drags a row or a whole section.
