import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Client, createEngine, styleOp, type Op } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, type Model } from "@/book/model";
import { FORMAT, type Book } from "@/book/note";
import { readOrder } from "@/book/order";
import { GENERATED_ORIGIN, sendBook } from "@/book/plan";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

async function fixture(): Promise<Model> {
  return readModel(await readText(vault, BOOK));
}

async function paths(): Promise<string[]> {
  return (await vault.list("/")).files;
}

/** The book's ops, resolved against the fixture vault. */
async function planned({ book, order }: Model): Promise<Op[]> {
  return sendBook(book, order, pathLinks(await paths()), BOOK, (at) =>
    readText(vault, at),
  );
}

/** One op from the list, typed to the shape that `op` names. */
function only<K extends Op["op"]>(ops: Op[], op: K): Extract<Op, { op: K }> {
  const found = ops.find(
    (candidate): candidate is Extract<Op, { op: K }> => candidate.op === op,
  );
  assert.ok(found, `no \`${op}\` op`);
  return found;
}

test("the resolved order crosses as one book op, split into one section per source", async () => {
  const ops = await planned(await fixture());

  assert.deepEqual(ops.map((op) => op.op), ["dialect", "split", "book", "metadata"]);
  assert.equal(only(ops, "split").level, 0);
  assert.deepEqual(
    only(ops, "book").sources.map((source) => source.name),
    [
      `${GENERATED_ORIGIN}:0`,
      "Copyright.md",
      "A note on the text.md",
      `${GENERATED_ORIGIN}:3`,
      "Volume the First.md",
      "Chapter Twelve.md",
      "Acknowledgements.md",
    ],
  );
});

test("a note's text crosses as it is on disk, and the section with no note is dropped", async () => {
  const ops = await planned(await fixture());
  const sources = only(ops, "book").sources;

  const copyright = sources.find((source) => source.name === "Copyright.md");
  assert.equal(copyright?.text, await readText(vault, "Copyright.md"));
  assert.ok(!sources.some((source) => source.name.includes("Chapter Four")));
});

test("a generated section is synthetic markdown, under a name no note can have", async () => {
  const ops = await planned(await fixture());
  const sources = only(ops, "book").sources;

  assert.equal(sources[0]?.text, "# Pride and Prejudice\n\nJane Austen");
  assert.equal(sources[3]?.text, "# Contents");
  assert.ok(!(await paths()).includes(sources[0]?.name ?? ""));
});

test("a title page with no metadata falls back to its role's own name", async () => {
  const book: Book = { format: FORMAT, metadata: {}, own: {} };
  const order = readOrder("- `title-page`\n");
  const ops = await sendBook(book, order, pathLinks([]), "Test.md", () =>
    Promise.reject(new Error("a generated section reads no note")),
  );

  assert.equal(only(ops, "book").sources[0]?.text, "# Title page");
});

test("the fixture book lays out and paints, over the bundled theme", async () => {
  const ops = await planned(await fixture());
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const client: Client = new Client({
      post: (request) => {
        engine.submit(request, (response) => {
          client.receive(response);
        });
      },
    });
    const output = await client.preview([
      ...ops,
      styleOp([{ name: THEME_SHEET, css: BUNDLED_THEME }]),
    ]);

    assert.ok(output, "the render was overtaken");
    assert.deepEqual(output.warnings, []);
    assert.ok(output.pages.length > 0);

    const text = output.pages
      .flatMap((page) => page.items)
      .flatMap((item) => (item.kind === "text" ? [item.text] : []));
    assert.ok(text.includes("Pride and Prejudice"));
    assert.ok(text.includes("Chapter Twelve"));
  } finally {
    engine.free();
  }
});

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: a reorder reaching a live session,
// which waits on the op planning that decides what a smaller edit
// invalidates.
