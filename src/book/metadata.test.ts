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
import { identified, readBook, type Book } from "@/book/note";

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

  // Publisher, series and isbn are orca's, and the engine writes none
  // of them into the document's information.
  assert.deepEqual(imprint(book), {
    publisher: "Whitehall Press",
    series: "The Bennet Novels",
    isbn: "978-0-000-00000-0",
  });
  const printed: Record<string, string> = { ...imprint(book) };
  for (const value of Object.values(printed)) {
    assert.equal(written.includes(value), false, value);
  }
});

test("the identifier reaches the engine's metadata, and the EPUB's package document carries it", async () => {
  const read = readBook(readFrontmatter(await readText(vault, BOOK)).properties);
  const sources = [{ name: CHAPTER, text: await readText(vault, CHAPTER) }];

  const book = identified(read, {});
  assert.equal(documentMetadata(book).extra?.["identifier"], book.identifier);
  assert.match(
    await packageDocument(book, sources),
    new RegExp(`<dc:identifier id="book-id">${book.identifier ?? ""}</dc:identifier>`),
  );

  // An edit to the book leaves the identifier as it is. With none, the
  // engine makes one from the book, which the same edit changes.
  const edited = [{ name: CHAPTER, text: `${sources[0]?.text ?? ""}\nOne more line.\n` }];
  assert.match(await packageDocument(book, edited), new RegExp(book.identifier ?? ""));
  const made = /<dc:identifier[^>]*>([^<]+)</;
  assert.equal(documentMetadata(read).extra?.["identifier"], undefined);
  assert.notEqual(
    made.exec(await packageDocument(read, sources))?.[1],
    made.exec(await packageDocument(read, edited))?.[1],
  );
});

/** The package document of the book's EPUB, from the engine in this thread. */
async function packageDocument(
  book: Book,
  sources: { name: string; text: string }[],
): Promise<string> {
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const client: Client = new Client({
      post: (request) => {
        engine.submit(request, (response) => {
          client.receive(response);
        });
      },
    });
    const epub = await client.exportEpubFiles([
      { op: "dialect", dialect: "obsidian" },
      { op: "split", level: 0 },
      { op: "book", sources },
      { op: "metadata", metadata: documentMetadata(book) },
    ]);
    assert.ok(epub, "the export was overtaken");
    const found = epub.files.find((file) => file.path.endsWith(".opf"));
    assert.ok(found, "the EPUB has no package document");
    return new TextDecoder().decode(found.bytes);
  } finally {
    engine.free();
  }
}

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

// What this tier does not cover: the title page the series and the
// publisher are printed on, which the plan's tests hold, and the isbn,
// which no page orca generates prints.
