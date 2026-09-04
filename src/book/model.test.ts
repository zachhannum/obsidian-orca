import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { readFrontmatter } from "@/book/frontmatter";
import { pathLinks } from "@/book/links";
import { readModel, withOrder, writeModel } from "@/book/model";
import { add, entries, entryName, resolve, writeOrder } from "@/book/order";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The note the author reads with the plugin off. */
async function text(): Promise<string> {
  return readText(vault, BOOK);
}

test("with the plugin disabled the note is an index of the book, with working links and a css block", async () => {
  const held = await text();
  const model = readModel(held);
  const paths = (await vault.list("/")).files;

  // Every entry is a line of markdown a reader follows: a wikilink,
  // and the role it takes where the heading does not carry it.
  const lines = writeOrder(model.order)
    .split("\n")
    .filter((line) => line.startsWith("- "));
  assert.deepEqual(lines, [
    "- `title-page`",
    "- [[Copyright]] `copyright`",
    "- [[A note on the text]] `epigraph`",
    "- `contents`",
    "- [[Volume the First]] `part`",
    "- [[Chapter Twelve]]",
    "- [[Chapter Four]]",
    "- [[Acknowledgements]]",
  ]);

  // The links Obsidian resolves are the links orca resolves. Chapter
  // Four is the note the fixture does not have.
  const { sections } = resolve(model.order, pathLinks(paths), BOOK);
  assert.deepEqual(
    sections.flatMap((section) =>
      section.kind === "missing" ? [entryName(section.entry)] : [],
    ),
    ["Chapter Four"],
  );

  // The author's css sits in the note in a fence, and is neither an
  // entry nor rewritten.
  assert.match(held, /\n```css\n[\s\S]*\n```\n$/);
  assert.equal(entries(model.order).length, 8);
  assert.equal(writeModel(model), held);
});

test("a body written back leaves the properties byte for byte as the note has them", async () => {
  const held = await text();
  const model = readModel(held);

  const grown = withOrder(held, add(model.order, "Chapter Thirteen", "Body"));

  assert.equal(
    grown.slice(0, held.indexOf("\n\n# Front matter")),
    held.slice(0, held.indexOf("\n\n# Front matter")),
  );
  assert.match(grown, /- \[\[Chapter Four\]\]\n- \[\[Chapter Thirteen\]\]\n/);
  assert.equal(readFrontmatter(grown).properties["status"], "drafting");
});

// What this tier does not cover: the two halves the view writes through
// Obsidian's own API, which the e2e job drives, and the design
// properties, which are the settings schema's to name.
