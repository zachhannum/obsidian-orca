import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import {
  Client,
  createEngine,
  styleOp,
  type Op,
  type Page,
  type Sheet,
} from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, type Model } from "@/book/model";
import { FORMAT, type Book } from "@/book/note";
import { readOrder } from "@/book/order";
import {
  GENERATED_ORIGIN,
  HELD_NOTHING,
  bookSources,
  sendBook,
  sendEdit,
  type Edit,
  type Held,
} from "@/book/plan";
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
    const client = connected(engine);
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

/** The sheets a session is styling with before an edit moves them. */
const SET: Sheet[] = [{ name: THEME_SHEET, css: BUNDLED_THEME }];

const WIDER: Sheet[] = [{ name: THEME_SHEET, css: "book { font-size: 13pt }" }];

const NARROWER: Sheet[] = [{ name: THEME_SHEET, css: "page { margin: 30mm }" }];

const FACED: Sheet[] = [
  { name: THEME_SHEET, css: 'book { font-family: "Spectral" }' },
];

/** A session with the theme on it and one face registered. */
const HELD: Held = { sheets: SET, faces: new Set(["eb-garamond"]) };

/** Reads one row of the table, by what the reader did. */
function row(did: string): Edit {
  const found = TABLE.find((entry) => entry.did === did);
  assert.ok(found, `no \`${did}\` row`);
  return found.edit;
}

/** The table the issue sets out, one row per edit. */
const TABLE: { did: string; edit: Edit; ops: Op["op"][] }[] = [
  {
    did: "typed in a chapter",
    edit: { did: "typed", name: "Chapter Twelve.md", text: "# Chapter Twelve" },
    ops: ["edit"],
  },
  {
    did: "moved a slider",
    edit: { did: "styled", sheets: WIDER },
    ops: ["style"],
  },
  {
    did: "changed a margin",
    edit: { did: "styled", sheets: NARROWER },
    ops: ["style"],
  },
  {
    did: "reordered chapters",
    edit: { did: "reordered", sources: [{ name: "A.md", text: "# A" }] },
    ops: ["book", "style"],
  },
  {
    did: "picked a new face",
    edit: {
      did: "faced",
      face: { key: "spectral", bytes: new Uint8Array([1, 2, 3]) },
      sheets: FACED,
    },
    ops: ["font", "style"],
  },
  {
    did: "deleted a note",
    edit: { did: "deleted", name: "Copyright.md" },
    ops: ["remove"],
  },
];

test("each edit sends the ops its row names, and nothing else", () => {
  for (const entry of TABLE) {
    const { ops } = sendEdit(entry.edit, HELD);
    assert.deepEqual(ops.map((op) => op.op), entry.ops, entry.did);
  }

  const typed = sendEdit(row("typed in a chapter"), HELD).ops;
  assert.equal(only(typed, "edit").name, "Chapter Twelve.md");
  const reordered = sendEdit(row("reordered chapters"), HELD).ops;
  assert.deepEqual(only(reordered, "style").sheets, SET);
});

test("a face already registered plans no font op at all", () => {
  const picked: Edit = {
    did: "faced",
    face: { key: "spectral", bytes: new Uint8Array([1, 2, 3]) },
    sheets: FACED,
  };

  const first = sendEdit(picked, HELD);
  assert.deepEqual(first.ops.map((op) => op.op), ["font", "style"]);

  const again = sendEdit(picked, first.held);
  assert.deepEqual(again.ops.map((op) => op.op), ["style"]);
  const third = sendEdit(picked, again.held);
  assert.deepEqual(third.ops.map((op) => op.op), ["style"]);
});

test("the same edit against the same session plans the same ops", () => {
  for (const entry of TABLE) {
    const once = sendEdit(entry.edit, HELD_NOTHING);
    const twice = sendEdit(entry.edit, HELD_NOTHING);
    assert.deepEqual(once.ops, twice.ops, entry.did);
  }
});

test("a typed chapter, a reorder and a deletion reach a live session", async () => {
  const model = await fixture();
  const links = pathLinks(await paths());
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const client = connected(engine);
    await client.preview([...(await planned(model)), styleOp(SET)]);
    const held: Held = { sheets: SET, faces: new Set() };
    assert.equal(await opens(client, []), "Pride and Prejudice");
    assert.ok((await words(client, [])).includes("Whitehall"));

    const typed = sendEdit(
      {
        did: "typed",
        name: "Chapter Twelve.md",
        text: "# Chapter Twelve\n\nElizabeth walked to Netherfield.",
      },
      held,
    );
    assert.ok((await words(client, typed.ops)).includes("Netherfield."));

    const sources = await bookSources(
      model.book,
      model.order,
      links,
      BOOK,
      (at) => readText(vault, at),
    );
    const reordered = sendEdit(
      { did: "reordered", sources: [...sources].reverse() },
      typed.held,
    );
    assert.equal(await opens(client, reordered.ops), "Acknowledgements");

    const deleted = sendEdit(
      { did: "deleted", name: "Copyright.md" },
      reordered.held,
    );
    const rest = await words(client, deleted.ops);
    assert.ok(!rest.includes("Whitehall"));
    assert.ok(rest.includes("carriage"));
  } finally {
    engine.free();
  }
});

/** Renders the ops and reads the words they put on the page. */
async function words(client: Client, ops: Op[]): Promise<string[]> {
  return (await painted(client, ops))
    .flatMap((page) => page.items)
    .flatMap((item) => (item.kind === "text" ? item.text.split(/\s+/) : []));
}

/**
 * Renders the ops and reads the line the book opens on, which a
 * reorder moves.
 */
async function opens(client: Client, ops: Op[]): Promise<string | undefined> {
  const first = (await painted(client, ops))[0];
  return first?.items.find((item) => item.kind === "text")?.text;
}

async function painted(client: Client, ops: Op[]): Promise<Page[]> {
  const output = await client.preview(ops);
  assert.ok(output, "the render was overtaken");
  return output.pages;
}

/** Wires a client to an engine, the way a session talks to one. */
function connected(engine: Awaited<ReturnType<typeof createEngine>>): Client {
  const client: Client = new Client({
    post: (request) => {
      engine.submit(request, (response) => {
        client.receive(response);
      });
    },
  });
  return client;
}

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: the face bytes of a `font` op reaching
// the engine, which waits on the font index that hashes a file.
