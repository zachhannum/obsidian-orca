import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Client, createEngine, type Op } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { readFrontmatter } from "@/book/frontmatter";
import { documentMetadata, imprint } from "@/book/metadata";
import { readBook, type Book } from "@/book/note";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

const BOOK = "Pride and Prejudice.md";
const CHAPTER = "Chapter Twelve.md";

test("title, author, language and date reach the PDF's document information", async () => {
  const book = readBook(readFrontmatter(await readText(vault, BOOK)).properties);

  const pdf = await set(book, [
    { name: CHAPTER, text: await readText(vault, CHAPTER) },
  ]);
  const written = new TextDecoder("latin1").decode(pdf);

  assert.match(written, /\/Title \(Pride and Prejudice\)/);
  assert.match(written, /\/Author \(Jane Austen\)/);
  assert.match(written, /\/Lang \(en-GB\)/);
  assert.match(written, /\/CreationDate \(D:18130128/);

  // Publisher, series and isbn are orca's: the engine has none of
  // them, and they land on the page orca generates.
  assert.deepEqual(imprint(book), {
    publisher: "Whitehall Press",
    series: "The Bennet Novels",
    isbn: "978-0-000-00000-0",
  });
  for (const value of Object.values(imprint(book))) {
    assert.equal(written.includes(value), false, value);
  }
});

/** The book as PDF bytes, from the engine in this thread. */
async function set(book: Book, sources: { name: string; text: string }[]): Promise<Uint8Array> {
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const client: Client = new Client({
      post: (request) => {
        engine.submit(request, (response) => {
          client.receive(response);
        });
      },
    });
    const ops: Op[] = [
      { op: "dialect", dialect: "obsidian" },
      { op: "split", level: 0 },
      { op: "book", sources },
      // A book read from several sources is unnamed until the metadata
      // reaches it, so this crosses after them.
      { op: "metadata", metadata: documentMetadata(book) },
    ];
    const pdf = await client.exportPdf(ops);
    assert.ok(pdf, "the export was overtaken");
    return pdf;
  } finally {
    engine.free();
  }
}

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: the generated page the imprint is set
// on, which waits on the roles that make one.
