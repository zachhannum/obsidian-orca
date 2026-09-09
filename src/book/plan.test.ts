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
  type LayoutOutput,
  type Op,
  type Page,
  type Sheet,
} from "fleuron";
import { directoryVault } from "@/assets/directory";
import { Registry, SENT_NOTHING, type Sent } from "@/assets/registry";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, type Model } from "@/book/model";
import { FORMAT, type Book } from "@/book/note";
import { readOrder } from "@/book/order";
import {
  GENERATED_ORIGIN,
  LOADED_NOTHING,
  bookSources,
  sendBook,
  sendEdit,
  type Edit,
  type Face,
  type Loaded,
  type Sending,
} from "@/book/plan";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The image the fixture book embeds, as its acknowledgements name it. */
const DEVICE = "device.png";

async function fixture(): Promise<Model> {
  return readModel(await readText(vault, BOOK));
}

/** Every file in the fixture vault, the way Obsidian sees one. */
async function paths(folder = "/"): Promise<string[]> {
  const { files, folders } = await vault.list(folder);
  const under = await Promise.all(folders.map((at) => paths(at)));
  return [...files, ...under.flat()];
}

/** The book's ops, resolved against the fixture vault. */
async function planned(model: Model): Promise<Op[]> {
  return (await sending(model)).ops;
}

/** The same, with the images the ops registered. */
async function sending({ book, order }: Model): Promise<Sending> {
  const registry = new Registry(vault);
  return sendBook(
    book,
    order,
    pathLinks(await paths()),
    BOOK,
    (at) => readText(vault, at),
    (at) => registry.take(at),
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

  assert.deepEqual(
    ops.map((op) => op.op),
    ["dialect", "split", "image", "book", "metadata"],
  );
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
  const { ops } = await sendBook(
    book,
    order,
    pathLinks([]),
    "Test.md",
    () => Promise.reject(new Error("a generated section reads no note")),
    () => Promise.reject(new Error("a generated section embeds nothing")),
  );

  assert.equal(only(ops, "book").sources[0]?.text, "# Title page");
});

test("an embed crosses as bytes, under the url the manuscript wrote", async () => {
  const { ops, images } = await sending(await fixture());

  assert.deepEqual(
    images.map((image) => image.url),
    [DEVICE],
    "the url is the one the note wrote, not the path it resolved to",
  );
  const image = only(ops, "image");
  assert.equal(image.url, DEVICE);
  assert.deepEqual(
    image.bytes,
    new Uint8Array(await vault.readBinary(`images/${DEVICE}`)),
  );
});

test("layout reads the header for the size and decodes nothing", async () => {
  const ops = await planned(await fixture());
  const output = await set(ops);

  assert.deepEqual(output.assets, [
    { url: DEVICE, intrinsic: { width: 220, height: 132, dpiX: 96, dpiY: 96 } },
  ]);
  const placed = output.pages
    .flatMap((page) => page.items)
    .filter((item) => item.kind === "image");
  assert.equal(placed.length, 1);
  assert.equal(placed[0]?.asset, 0);
  // Points, off the header's own pixels and resolution.
  assert.equal(placed[0]?.w, 165);
  assert.equal(placed[0]?.h, 99);
});

test("an embed the vault cannot answer is a warning, and the book still sets", async () => {
  const model = await fixture();
  const sources = await bookSources(
    model.book,
    model.order,
    pathLinks(await paths()),
    BOOK,
    (at) => readText(vault, at),
  );
  const gone = sources.map((source) => ({
    ...source,
    text: source.text.replace(`![[${DEVICE}]]`, "![[nothing here.png]]"),
  }));

  const output = await set([
    { op: "dialect", dialect: "obsidian" },
    { op: "split", level: 0 },
    { op: "book", sources: gone },
  ]);

  assert.ok(output.pages.length > 0, "the page is set without the image");
  assert.deepEqual(output.assets, []);
  assert.deepEqual(
    output.warnings.map((warning) => warning.message),
    ["image nothing here.png: no image was supplied for it; it is skipped"],
  );
});

test("the fixture book typesets and paints, over the bundled theme", async () => {
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

/** A session with the theme on it. */
const LOADED: Loaded = { sheets: SET };

/** A registry holding the bundled face and nothing else. */
const REGISTERED: Sent = { sent: (key) => key === "eb-garamond" };

/** The cuts the table picks, and the key each one's bytes hash to. */
const SPECTRAL: Face[] = [
  { key: "spectral-regular", bytes: new Uint8Array([1, 2, 3]) },
  { key: "spectral-italic", bytes: new Uint8Array([4, 5, 6]) },
  { key: "spectral-bold", bytes: new Uint8Array([7, 8, 9]) },
];

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
    did: "picked a new family",
    edit: {
      did: "faced",
      faces: SPECTRAL,
      sheets: FACED,
    },
    ops: ["font", "font", "font", "style"],
  },
  {
    did: "deleted a note",
    edit: { did: "deleted", name: "Copyright.md" },
    ops: ["remove"],
  },
  {
    did: "embedded an image",
    edit: {
      did: "embedded",
      images: [{ url: DEVICE, key: "device", bytes: new Uint8Array([1, 2]) }],
    },
    ops: ["image"],
  },
];

test("each edit sends the ops its row names, and nothing else", () => {
  for (const entry of TABLE) {
    const { ops } = sendEdit(entry.edit, LOADED, REGISTERED);
    assert.deepEqual(ops.map((op) => op.op), entry.ops, entry.did);
  }

  const typed = sendEdit(row("typed in a chapter"), LOADED, REGISTERED).ops;
  assert.equal(only(typed, "edit").name, "Chapter Twelve.md");
  const reordered = sendEdit(row("reordered chapters"), LOADED, REGISTERED).ops;
  assert.deepEqual(only(reordered, "style").sheets, SET);

  // A family has several cuts, so each one crosses on a `font` op of
  // its own, in the order `faces` holds them.
  // An image is keyed on its url rather than on its bytes, so the
  // registry is not what decides whether it crosses.
  const embedded = sendEdit(row("embedded an image"), LOADED, REGISTERED).ops;
  assert.equal(only(embedded, "image").url, DEVICE);
  assert.deepEqual(only(embedded, "image").bytes, new Uint8Array([1, 2]));

  const picked = sendEdit(row("picked a new family"), LOADED, REGISTERED).ops;
  assert.deepEqual(
    picked.flatMap((op) => (op.op === "font" ? [op.bytes] : [])),
    SPECTRAL.map((face) => face.bytes),
  );
  assert.equal(picked.at(-1)?.op, "style");
});

test("every op path asks the registry before it puts bytes on the wire", () => {
  const asked: string[] = [];
  const watching: Sent = {
    sent: (key) => {
      asked.push(key);
      return false;
    },
  };

  for (const entry of TABLE) sendEdit(entry.edit, LOADED, watching);
  assert.deepEqual(
    asked,
    SPECTRAL.map((face) => face.key),
    "only the family's cuts carry bytes",
  );

  const registry = new Registry(vault);
  const picked = row("picked a new family");
  const first = sendEdit(picked, LOADED, registry);
  assert.deepEqual(first.crossed, SPECTRAL.map((face) => face.key));
  for (const key of first.crossed) registry.crossed(key);
  assert.ok(registry.sent("spectral-italic"));

  const again = sendEdit(picked, first.loaded, registry);
  assert.deepEqual(again.ops.map((op) => op.op), ["style"]);
  assert.deepEqual(again.crossed, []);
});

test("a book with the same face on thirty-four chapters sends it once", async () => {
  const registry = new Registry(vault);
  const bytes = await readFile(path.join(root, "fixture", BOOK));
  // Thirty-four picks over one file, named by two different paths.
  const picks = await Promise.all(
    Array.from({ length: 34 }, (_, at) =>
      registry.take(at % 2 === 0 ? BOOK : `/${BOOK}`),
    ),
  );

  let loaded = LOADED;
  let fonts = 0;
  for (const face of picks) {
    const planned = sendEdit(
      { did: "faced", faces: [face], sheets: FACED },
      loaded,
      registry,
    );
    loaded = planned.loaded;
    for (const key of planned.crossed) registry.crossed(key);
    fonts += planned.ops.filter((op) => op.op === "font").length;
  }

  assert.equal(fonts, 1);
  assert.equal(new Set(picks.map((pick) => pick.key)).size, 1);
  assert.equal(picks[0]?.bytes.byteLength, bytes.byteLength);

  // The family is picked again with a cut that has already crossed.
  // The other two cuts go on the wire and that one does not.
  const crossed = picks[0];
  assert.ok(crossed, "the file was never read");
  const family = [crossed, ...SPECTRAL.slice(1)];
  const again = sendEdit(
    { did: "faced", faces: family, sheets: FACED },
    loaded,
    registry,
  );

  assert.deepEqual(again.ops.map((op) => op.op), ["font", "font", "style"]);
  assert.deepEqual(
    again.crossed,
    SPECTRAL.slice(1).map((face) => face.key),
  );
});

test("the same edit against the same session plans the same ops", () => {
  for (const entry of TABLE) {
    const once = sendEdit(entry.edit, LOADED_NOTHING, SENT_NOTHING);
    const twice = sendEdit(entry.edit, LOADED_NOTHING, SENT_NOTHING);
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
    const loaded: Loaded = { sheets: SET };
    assert.equal(await opens(client, []), "Pride and Prejudice");
    assert.ok((await words(client, [])).includes("Whitehall"));

    const typed = sendEdit(
      {
        did: "typed",
        name: "Chapter Twelve.md",
        text: "# Chapter Twelve\n\nElizabeth walked to Netherfield.",
      },
      loaded,
      SENT_NOTHING,
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
      typed.loaded,
      SENT_NOTHING,
    );
    assert.equal(await opens(client, reordered.ops), "Acknowledgements");

    const deleted = sendEdit(
      { did: "deleted", name: "Copyright.md" },
      reordered.loaded,
      SENT_NOTHING,
    );
    const rest = await words(client, deleted.ops);
    assert.ok(!rest.includes("Whitehall"));
    assert.ok(rest.includes("carriage"));
  } finally {
    engine.free();
  }
});

/** Sets these ops on an engine of their own, over the bundled theme. */
async function set(ops: Op[]): Promise<LayoutOutput> {
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const output = await connected(engine).preview([
      ...ops,
      styleOp([{ name: THEME_SHEET, css: BUNDLED_THEME }]),
    ]);
    assert.ok(output, "the render was overtaken");
    return output;
  } finally {
    engine.free();
  }
}

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
// the engine, which the session tier tests, and the cuts a family is
// made of, which belong to the font index.
