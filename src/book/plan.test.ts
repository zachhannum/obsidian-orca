import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import {
  Client,
  createEngine,
  styleOp,
  type Epub,
  type EpubFiles,
  type LayoutOutput,
  type Op,
  type Page,
  type Sheet,
} from "fleuron";
import { directoryVault } from "@/assets/testUtils/directory";
import { VAULT_FONTS, familyNamed, fontIndex, scanFonts } from "@/assets/fonts";
import { Registry, SENT_NOTHING, fontUrl, type Sent } from "@/assets/registry";
import { usedVariant, variantFamily } from "@/assets/variants";
import { faceCss, type Registered } from "@/style/faces";
import { FACES_SHEET } from "@/style/sheet";
import { readText, type VaultAdapter } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { epubText } from "@/book/testUtils/epub";
import { countWords } from "@/book/words";
import { readModel, type Model } from "@/book/model";
import { sectionIds } from "@/book/names";
import { bookCss } from "@/book/css";
import { FORMAT, type Book } from "@/book/note";
import { readOrder, resolve } from "@/book/order";
import { bookUses, emptyDesign } from "@/style/design";
import { readOrigin } from "@/style/origin";
import {
  GENERATED_ORIGIN,
  LOADED_NOTHING,
  bookImages,
  bookSources,
  cssImages,
  sendBook,
  sendEdit,
  sendFaces,
  type Edit,
  type Face,
  type Loaded,
  type Sending,
} from "@/book/plan";
import { designSheets } from "@/style/sheet";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The image the fixture book embeds, as its acknowledgements name it. */
const DEVICE = "device.png";

/** The book note in the vault the docs site sets its pages from. */
const SAMPLE_BOOK =
  "Twenty Thousand Leagues/Twenty Thousand Leagues Under the Sea.md";

async function fixture(): Promise<Model> {
  return readModel(await readText(vault, BOOK));
}

/** Every file in the fixture vault, the way Obsidian sees one. */
async function paths(folder = "/"): Promise<string[]> {
  return under(vault, folder);
}

/** Every file in a vault, the way Obsidian sees one. */
async function under(from: VaultAdapter, folder = "/"): Promise<string[]> {
  const { files, folders } = await from.list(folder);
  const inside = await Promise.all(folders.map((at) => under(from, at)));
  return [...files, ...inside.flat()];
}

/** The book's ops, resolved against the fixture vault. */
async function planned(model: Model): Promise<Op[]> {
  return (await sending(model)).ops;
}

/** The same, with the images the ops registered. */
async function sending({ book, order }: Model, css = ""): Promise<Sending> {
  const registry = new Registry(vault);
  return sendBook(
    book,
    order,
    pathLinks(await paths()),
    BOOK,
    css,
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
      "Chapter Fifteen.md",
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

test("the contents links each part and chapter in reading order, under a name no note can have", async () => {
  const ops = await planned(await fixture());
  const sources = only(ops, "book").sources;

  assert.equal(
    sources[3]?.text,
    "# Contents\n\n" +
      "{.part}\n\n[Volume the First](Volume%20the%20First.md#Volume%20the%20First)\n\n" +
      "{.entry}\n\n[Chapter Twelve](Chapter%20Twelve.md#Chapter%20Twelve)\n\n" +
      "{.folio}\n\n[](Chapter%20Twelve.md#Chapter%20Twelve)\n\n" +
      "{.entry}\n\n[Chapter Fifteen](Chapter%20Fifteen.md#Chapter%20Fifteen)\n\n" +
      "{.folio}\n\n[](Chapter%20Fifteen.md#Chapter%20Fifteen)",
  );
  assert.ok(!(await paths()).includes(sources[0]?.name ?? ""));
});

test("a title page is set from the book's properties each time the book is sent", async () => {
  const model = await fixture();
  const sources = only(await planned(model), "book").sources;

  assert.equal(
    sources[0]?.text,
    "The Bennet Novels\n\n# Pride and Prejudice\n\nJane Austen\n\nWhitehall Press",
  );

  // A book with other properties and no series sends a title page with
  // no block for the series.
  const changed: Model = {
    ...model,
    book: {
      ...model.book,
      metadata: { title: "Emma", author: "Jane Austen", publisher: "John Murray" },
    },
  };
  assert.equal(
    only(await planned(changed), "book").sources[0]?.text,
    "# Emma\n\nJane Austen\n\nJohn Murray",
  );
});

test("an EPUB of the fixture book opens with the title page, as a document of its own", async () => {
  const { spine, files } = await epubFiles(await planned(await fixture()));
  const first = new TextDecoder().decode(
    files.find((file) => file.path === spine[0]?.path)?.bytes,
  );

  assert.match(first, /<section [^>]*id="title-page"/);
  assert.equal(first.match(/<section /g)?.length, 1);
  const words = first.replace(/<[^>]+>/g, " ");
  for (const block of ["The Bennet Novels", "Pride and Prejudice", "Jane Austen", "Whitehall Press"]) {
    assert.ok(words.includes(block), block);
  }
});

test("an EPUB of the fixture book carries a document for each section the book sends, the contents among them, and no other", async () => {
  const ops = await planned(await fixture());
  const { spine, files } = await epubFiles(ops);
  const documents = spine.map((entry) => ({
    path: entry.path.replace(/^.*\//, ""),
    text: new TextDecoder().decode(files.find((file) => file.path === entry.path)?.bytes),
  }));
  const held = (text: string) => [...text.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(
    documents.map(({ text }) => held(text)),
    only(ops, "book").sources.map((source) => [source.attributes?.id]),
  );

  const contents = documents.find(({ text }) => held(text).includes("contents"))?.text ?? "";
  const entries = [...contents.matchAll(/class="entry"><a href="([^#"]+)#[^"]*">([^<]+)</g)];
  assert.deepEqual(
    entries.map((entry) => entry[2]),
    ["Chapter Twelve", "Chapter Fifteen"],
  );
  assert.deepEqual(
    entries.map((entry) => entry[1]),
    ["chapter-twelve", "chapter-fifteen"].map((id) => documents.find(({ text }) => held(text).includes(id))?.path),
  );
});

test("a title page with no metadata falls back to its role's own name", async () => {
  const book: Book = {
    format: FORMAT,
    metadata: {},
    fonts: [],
    design: emptyDesign(),
    own: {},
  };
  const order = readOrder("- `title-page`\n");
  const { ops } = await sendBook(
    book,
    order,
    pathLinks([]),
    "Test.md",
    "",
    () => Promise.reject(new Error("a generated section reads no note")),
    () => Promise.reject(new Error("a generated section embeds nothing")),
  );

  assert.equal(only(ops, "book").sources[0]?.text, "# Title page");
});

test("an embed crosses as bytes, under the url the manuscript names it by", async () => {
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

test("a url the CSS names outside @font-face crosses as an image op, under the url as written", async () => {
  const css = [
    '@font-face { font-family: "Junicode"; src: url("fonts/Junicode-Regular.otf"); }',
    '@page { background-image: url("images/device.png"); }',
  ].join("\n");
  const { ops } = await sending(await fixture(), css);

  assert.deepEqual(
    ops.map((op) => op.op),
    ["dialect", "split", "image", "image", "book", "metadata"],
  );
  const styled = ops.filter((op) => op.op === "image").at(-1);
  assert.equal(styled?.url, "images/device.png");
  assert.deepEqual(
    styled?.bytes,
    new Uint8Array(await vault.readBinary(`images/${DEVICE}`)),
  );

  // The engine paints the background from the bytes under that url. A
  // style op replaces every sheet, so the theme crosses with the CSS.
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const output = await connected(engine).preview([
      ...ops,
      styleOp([
        { name: THEME_SHEET, css: BUNDLED_THEME },
        { name: "book.css", css },
      ]),
    ]);
    assert.ok(output, "the render was overtaken");
    const items = output.pages.flatMap((page) => page.items);
    assert.ok(items.some((item) => item.kind === "background"));
  } finally {
    engine.free();
  }
});

test("a url in the CSS resolves through the vault like an embed, and a url outside it crosses nothing", async () => {
  const taken: string[] = [];
  const registry = new Registry(vault);
  const images = await cssImages(
    [
      "@page { background-image: url(device.png); }",
      'h1 { background-image: url("nothing here.png"); }',
      'h2 { background-image: url("https://example.com/device.png"); }',
    ].join("\n"),
    pathLinks(await paths()),
    BOOK,
    (at) => {
      taken.push(at);
      return registry.take(at);
    },
  );

  assert.deepEqual(taken, [`images/${DEVICE}`]);
  assert.deepEqual(
    images.map((image) => image.url),
    [DEVICE],
  );
});

test("a url both a chapter and the CSS name crosses once", async () => {
  const { ops, images } = await sending(
    await fixture(),
    `@page { background-image: url("${DEVICE}"); }`,
  );

  assert.deepEqual(
    ops.filter((op) => op.op === "image").map((op) => op.url),
    [DEVICE],
  );
  assert.deepEqual(
    images.map((image) => image.url),
    [DEVICE],
  );
});

test("the cover names a vault image, which crosses once, and the metadata names it as the cover", async () => {
  const model = await fixture();
  const covered = (cover: string): Model => ({
    ...model,
    book: { ...model.book, metadata: { ...model.book.metadata, cover } },
  });

  // A cover no chapter embeds crosses as one more image, under the url the property names.
  const own = await sending(covered("images/device.png"));
  assert.deepEqual(
    own.ops.filter((op) => op.op === "image").map((op) => op.url),
    [DEVICE, "images/device.png"],
  );
  assert.deepEqual(
    own.ops.filter((op) => op.op === "image").at(-1)?.bytes,
    new Uint8Array(await vault.readBinary(`images/${DEVICE}`)),
  );
  assert.equal(only(own.ops, "metadata").metadata.extra?.["cover"], "images/device.png");

  // A cover a chapter embeds is on the wire already, written as a path or as a link.
  for (const written of [DEVICE, `[[${DEVICE}]]`, `![[${DEVICE}|The device]]`]) {
    const { ops, images } = await sending(covered(written));
    assert.deepEqual(
      ops.filter((op) => op.op === "image").map((op) => op.url),
      [DEVICE],
      written,
    );
    assert.deepEqual(images.map((image) => image.url), [DEVICE]);
    assert.equal(only(ops, "metadata").metadata.extra?.["cover"], DEVICE);
  }

  // The engine marks that image as the cover in the package document.
  const { files, warnings } = await epubFiles(own.ops);
  const manifest = new TextDecoder().decode(
    files.find((file) => file.path.endsWith(".opf"))?.bytes,
  );
  assert.equal(manifest.match(/properties="cover-image"/g)?.length, 1);
  assert.match(manifest, /<item [^>]*media-type="image\/png" properties="cover-image"\/>/);
  assert.deepEqual(warnings.filter((warning) => /cover/i.test(warning.message)), []);
});

test("a cover that names no image in the vault sends no bytes, and the engine warns about it", async () => {
  const model = await fixture();
  const { ops } = await sending({
    ...model,
    book: { ...model.book, metadata: { ...model.book.metadata, cover: "nothing here.png" } },
  });

  assert.deepEqual(
    ops.filter((op) => op.op === "image").map((op) => op.url),
    [DEVICE],
  );
  const { files, warnings } = await epubFiles(ops);
  const about = warnings.filter((warning) => /cover/i.test(warning.message));
  assert.deepEqual(about, [
    {
      message: "Cover image nothing here.png did not load. It is left out of the EPUB.",
      origin: null,
    },
  ]);
  const manifest = new TextDecoder().decode(
    files.find((file) => file.path.endsWith(".opf"))?.bytes,
  );
  assert.doesNotMatch(manifest, /cover-image/);
});

test("layout reads the header for the size and decodes nothing", async () => {
  const ops = await planned(await fixture());
  const output = await set(ops);

  assert.deepEqual(output.assets, [
    { url: DEVICE, intrinsic: { width: 220, height: 132, dpiX: 96, dpiY: 96, sized: true } },
  ]);
  const placed = output.pages
    .flatMap((page) => page.items)
    .filter((item) => item.kind === "image");
  // Two notes embed the one image, and both placements name the asset
  // the header was read for.
  assert.equal(placed.length, 2);
  for (const item of placed) {
    assert.equal(item.asset, 0);
    // Points, from the header's own pixels and resolution.
    assert.equal(item.w, 165);
    assert.equal(item.h, 99);
  }
});

test("an embed with no file behind it is a warning, and the book still sets", async () => {
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
    ["No image was supplied for nothing here.png. The image is skipped."],
  );
});

test("a character the face lacks is a warning at its note and line", async () => {
  const model = await fixture();
  const sources = await bookSources(
    model.book,
    model.order,
    pathLinks(await paths()),
    BOOK,
    (at) => readText(vault, at),
  );
  const whaled = sources.map((source) => ({
    ...source,
    text: source.text.replace("In consequence", "In \u{1F40B} consequence"),
  }));
  const chapter = whaled.find((source) => source.text.includes("\u{1F40B}"));
  assert.ok(chapter !== undefined, "no fixture chapter took the character");
  const line =
    chapter.text.slice(0, chapter.text.indexOf("\u{1F40B}")).split("\n").length;

  const output = await set([
    { op: "dialect", dialect: "obsidian" },
    { op: "split", level: 0 },
    { op: "book", sources: whaled },
  ]);

  const lacked = output.warnings.filter((warning) =>
    warning.message.includes("U+1F40B"),
  );
  // One warning for the character, however many pages it lands on.
  assert.deepEqual(
    lacked.map((warning) => warning.message),
    ["EB Garamond Regular has no glyph for `\u{1F40B}` (U+1F40B)."],
  );
  assert.deepEqual(readOrigin(lacked[0]?.origin ?? ""), {
    sheet: chapter.name,
    line,
    column: 4,
  });
});

test("an embed with no file, or a file that will not read, is unread with its note and line", async () => {
  const sources = [
    { name: "One.md", text: ["# One", "", "![[device.png]]", ""].join("\n") },
    {
      name: "Two.md",
      text: ["# Two", "", "![[nothing here.png]]", "", "![](broken.png)", ""].join(
        "\n",
      ),
    },
  ];
  const links = pathLinks([`images/${DEVICE}`, "images/broken.png"]);
  const registry = new Registry(vault);

  const { images, unread } = await bookImages(sources, links, (at) =>
    at === "images/broken.png"
      ? Promise.reject(new Error("the file will not read"))
      : registry.take(at),
  );

  assert.deepEqual(
    images.map((image) => image.url),
    [DEVICE],
  );
  assert.deepEqual(unread, [
    { url: "nothing here.png", note: "Two.md", line: 2 },
    { url: "broken.png", note: "Two.md", line: 4 },
  ]);
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

/** The sheets a reorder generates again, against the order it moved to. */
const RECOUNTED: Sheet[] = [
  { name: THEME_SHEET, css: "section:nth-child(1) { page: chapter }" },
];

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
    edit: {
      did: "reordered",
      sources: [{ name: "A.md", text: "# A" }],
      sheets: RECOUNTED,
    },
    ops: ["book", "style"],
  },
  {
    did: "picked a new family",
    edit: {
      did: "fonted",
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
  // A positional selector matches on where a source sits, so the
  // sheets generated against the new order cross with it.
  const reordered = sendEdit(row("reordered chapters"), LOADED, REGISTERED);
  assert.deepEqual(only(reordered.ops, "style").sheets, RECOUNTED);
  assert.deepEqual(reordered.loaded.sheets, RECOUNTED);

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

test("a face a `@font-face` rule names crosses under its url, and one with none crosses bare", () => {
  const faces: Face[] = [
    { key: "junicode-regular", bytes: new Uint8Array([1]), url: "orca-font:junicode-regular" },
    { key: "eb-garamond-regular", bytes: new Uint8Array([2]) },
  ];
  const planned = sendEdit(
    { did: "fonted", faces, sheets: FACED },
    LOADED,
    SENT_NOTHING,
  );
  const fonts = planned.ops.filter((op) => op.op === "font");
  assert.deepEqual(
    fonts.map((op) => ("url" in op ? op.url : undefined)),
    ["orca-font:junicode-regular", undefined],
  );
  assert.deepEqual(sendFaces(faces), fonts);
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
      { did: "fonted", faces: [face], sheets: FACED },
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
    { did: "fonted", faces: family, sheets: FACED },
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
    assert.equal(await opens(client, []), "The Bennet Novels");
    assert.ok((await words(client, [])).includes("moral"));

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
      { did: "reordered", sources: [...sources].reverse(), sheets: SET },
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
    assert.ok(!rest.includes("moral"));
    assert.ok(rest.includes("carriage"));
  } finally {
    engine.free();
  }
});

test("a paragraph's section carries its role as its class and its entry's slug as its id, through an edit and a rename", async () => {
  const model = await fixture();
  const links = pathLinks(await paths());
  const chapter = "Chapter Twelve.md";
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const client = connected(engine);
    await client.preview([...(await planned(model)), styleOp(SET)]);

    /** The section around the first paragraph of the chapter, as the inspector sees it. */
    async function section(): Promise<{ id: string | null; classes: string[] }> {
      const text = await readText(vault, chapter);
      const opening = text.indexOf("In consequence");
      assert.ok(opening >= 0, "the chapter no longer opens on its paragraph");
      const byte = Buffer.byteLength(text.slice(0, opening));
      const node = await client.nodeAt(chapter, byte);
      assert.ok(node !== null, "no node at the chapter's first paragraph");
      const inspected = await client.inspect(node);
      assert.ok(inspected, "the paragraph was not inspected");
      const found = inspected.ancestors.find((ancestor) => ancestor.element === "section");
      assert.ok(found, "the paragraph sits in no section");
      return { id: found.id, classes: found.classes };
    }

    assert.deepEqual(await section(), { id: "chapter-twelve", classes: ["chapter"] });

    // A typed edit sends no names, and the engine keeps the ones it had.
    const typed = sendEdit(
      { did: "typed", name: chapter, text: await readText(vault, chapter) },
      LOADED,
      SENT_NOTHING,
    );
    assert.equal(only(typed.ops, "edit").name, chapter);
    await painted(client, typed.ops);
    assert.deepEqual(await section(), { id: "chapter-twelve", classes: ["chapter"] });

    // A renamed entry changes the book note, and the book crosses again
    // with the new id.
    const renamed = readModel(
      (await readText(vault, BOOK)).replace("[[Chapter Twelve]]", "[[Chapter Twelve|The Harbor]]"),
    );
    const sources = await bookSources(
      renamed.book,
      renamed.order,
      links,
      BOOK,
      (at) => readText(vault, at),
    );
    await painted(client, sendEdit({ did: "reordered", sources, sheets: SET }, LOADED, SENT_NOTHING).ops);
    assert.deepEqual(await section(), { id: "the-harbor", classes: ["chapter"] });
  } finally {
    engine.free();
  }
});

test("every source in the book op carries its names, and generated matter is named by its role", async () => {
  const sources = only(await planned(await fixture()), "book").sources;

  assert.deepEqual(
    sources.map((source) => source.attributes),
    [
      { classes: ["title-page"], id: "title-page" },
      { classes: ["copyright"], id: "copyright" },
      { classes: ["epigraph"], id: "a-note-on-the-text" },
      { classes: ["contents"], id: "contents" },
      { classes: ["part"], id: "volume-the-first" },
      { classes: ["chapter"], id: "chapter-twelve" },
      { classes: ["chapter"], id: "chapter-fifteen" },
      { classes: ["back-matter"], id: "acknowledgements" },
    ],
  );
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

/** The book's EPUB as its files, from an engine of its own. */
async function epubFiles(ops: Op[]): Promise<EpubFiles> {
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const epub = await connected(engine).exportEpubFiles(ops);
    assert.ok(epub, "the export was overtaken");
    return epub;
  } finally {
    engine.free();
  }
}

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

/**
 * The ops that send a book in a vault. They carry what the composer
 * sends, so the faces are the ones the design names and the book's
 * own CSS is the last sheet.
 */
async function bookOps(from: VaultAdapter, name: string): Promise<Op[]> {
  const model = readModel(await readText(from, name));
  const links = pathLinks(await under(from));
  const registry = new Registry(from);
  const css = bookCss(model.order);
  const { ops } = await sendBook(
    model.book,
    model.order,
    links,
    name,
    css,
    (at) => readText(from, at),
    (at) => registry.take(at),
  );
  const { sections } = resolve(model.order, links, name);
  const { title, author, publisher } = model.book.metadata;
  const index = fontIndex(
    { faces: [], refused: [] },
    await scanFonts(
      {
        list: (directory) => from.list(directory),
        read: async (at, start, length) =>
          new Uint8Array(await from.readBinary(at)).subarray(start, start + length),
      },
      [VAULT_FONTS],
      "vault",
    ),
  );
  const faces: Awaited<ReturnType<Registry["take"]>>[] = [];
  const registered: Registered[] = [];
  for (const use of bookUses(model.book.design, model.book.fonts)) {
    const family = familyNamed(index, use.font);
    if (family === undefined) continue;
    const { variant } = usedVariant(family, use.variant);
    const crossed = await Promise.all(
      variant.faces.map(async (face) => {
        const hashed = await registry.take(face.path);
        return { ...hashed, url: fontUrl(hashed.key) };
      }),
    );
    faces.push(...crossed);
    registered.push({
      ...use,
      family: variantFamily(family, variant),
      faces: variant.faces.map((face, at) => ({
        url: crossed[at]?.url ?? "",
        weight: face.weight,
        italic: face.italic,
      })),
    });
  }

  return [
    ...ops,
    ...sendFaces(faces),
    styleOp(
      designSheets(
        model.book.design,
        { sections: sectionIds(sections), title, author, publisher },
        css,
        registered,
      ),
    ),
  ];
}

/** A book in a vault, exported with the faces in its `fonts` folder, as a PDF file on disk. */
async function exportedBook(from: VaultAdapter, name: string): Promise<string> {
  const ops = await bookOps(from, name);
  const engine = await createEngine({ wasm: await moduleBytes() });
  let pdf: Uint8Array | null;
  try {
    pdf = await connected(engine).exportPdf(ops);
  } finally {
    engine.free();
  }
  assert.ok(pdf, "the export was overtaken");

  const written = path.join(await mkdtemp(path.join(tmpdir(), "orca-")), "book.pdf");
  await writeFile(written, pdf);
  return written;
}

/**
 * The most words the pages print that an EPUB does not: a running head
 * and a folio on a page that carries them, and a folio beside each
 * contents entry. An EPUB has no pages, so it prints none of them.
 */
const FURNITURE = 60;

/** A book in a vault, exported with the faces in its `fonts` folder, as an EPUB. */
async function exportedEpub(from: VaultAdapter, name: string): Promise<Epub> {
  const ops = await bookOps(from, name);
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const epub = await connected(engine).exportEpub(ops);
    assert.ok(epub, "the export was overtaken");
    return epub;
  } finally {
    engine.free();
  }
}

test("Junicode sets in Regular, and its bold in Junicode Bold, in the preview and the PDF", async () => {
  const index = fontIndex(
    { faces: [], refused: [] },
    await scanFonts(
      {
        list: (directory) => vault.list(directory),
        read: async (at, from, length) =>
          new Uint8Array(await vault.readBinary(at)).subarray(from, from + length),
      },
      [VAULT_FONTS],
      "vault",
    ),
  );
  const family = familyNamed(index, "Junicode");
  assert.ok(family, "the fixture vault carries no Junicode");
  const registry = new Registry(vault);
  // Every cut crosses under its url, so only the rules decide which
  // ones the book can reach.
  const faces = await Promise.all(
    family.faces.map(async (face) => {
      const hashed = await registry.take(face.path);
      return { ...hashed, url: fontUrl(hashed.key) };
    }),
  );
  const { variant } = usedVariant(family, undefined);
  const registered: Registered = {
    font: family.name,
    variant: undefined,
    family: variantFamily(family, variant),
    faces: variant.faces.map((face) => {
      const crossed = faces[family.faces.indexOf(face)];
      assert.ok(crossed);
      return { url: crossed.url, weight: face.weight, italic: face.italic };
    }),
  };
  const ops: Op[] = [
    { op: "book", sources: [{ name: "A.md", text: "Plain words and **bold words**." }] },
    ...sendFaces(faces),
    styleOp([
      { name: THEME_SHEET, css: BUNDLED_THEME },
      { name: FACES_SHEET, css: faceCss([registered]) },
      { name: "design.css", css: 'book { font-family: "Junicode", serif }' },
    ]),
  ];

  const engine = await createEngine({ wasm: await moduleBytes() });
  let pdf: Uint8Array | null;
  try {
    const client = connected(engine);
    const output = await client.preview(ops);
    assert.ok(output, "the render was overtaken");
    const runs = output.pages.flatMap((page) =>
      page.items.flatMap((item) => (item.kind === "text" ? [item] : [])),
    );
    const faceOf = (words: string) => {
      const run = runs.find((item) => item.text.includes(words));
      assert.ok(run, `no run sets "${words}"`);
      const entry = output.fonts[run.fontId];
      assert.ok(entry);
      return entry;
    };
    assert.equal(faceOf("Plain").style, "Regular");
    assert.equal(faceOf("bold").style, "Bold");
    for (const run of runs) {
      assert.doesNotMatch(output.fonts[run.fontId]?.name ?? "", /Cond|Exp/);
    }
    pdf = await client.exportPdf(ops);
  } finally {
    engine.free();
  }
  assert.ok(pdf, "the export was overtaken");
  const written = path.join(await mkdtemp(path.join(tmpdir(), "orca-")), "junicode.pdf");
  await writeFile(written, pdf);
  const embedded = spawnSync("pdffonts", [written], { encoding: "utf8" }).stdout;
  assert.match(embedded, /Junicode-Regular/);
  assert.match(embedded, /Junicode-Bold/);
  assert.doesNotMatch(embedded, /Junicode-(Cond|Exp)/);
});

test("the site's sample book sets to a PDF that qpdf reads", async () => {
  const sample = directoryVault(path.join(root, "docs/sample"));
  const written = await exportedBook(sample, SAMPLE_BOOK);

  const checked = spawnSync("qpdf", ["--check", written], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

test("the site's sample book sets with no warning", async () => {
  const sample = directoryVault(path.join(root, "docs/sample"));
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const output = await connected(engine).preview(await bookOps(sample, SAMPLE_BOOK));
    assert.ok(output, "the render was overtaken");
    // The site's pictures show the warning count. The one warning they
    // show comes from CSS that the screenshot spec types in.
    assert.deepEqual(
      output.warnings.map((warning) => warning.message),
      [],
    );
  } finally {
    engine.free();
  }
});

test("the fixture book exports as an EPUB, and no page rule in its sheets warns", async () => {
  const epub = await exportedEpub(vault, BOOK);

  // A zip opens on a local file header, and an EPUB's first file is its mimetype.
  assert.deepEqual([...epub.bytes.subarray(0, 2)], [0x50, 0x4b]);
  assert.match(new TextDecoder().decode(epub.bytes.subarray(30, 58)), /^mimetypeapplication\/epub\+zip/);
  const paged = epub.warnings.filter((warning) => /@page|page rule|margin box/i.test(warning.message));
  assert.deepEqual(paged, []);
});

test("the fixture book's EPUB holds the words its PDF holds, less the running heads and the folios", async () => {
  const { bytes } = await exportedEpub(vault, BOOK);
  const read = spawnSync("pdftotext", [await exportedBook(vault, BOOK), "-"], { encoding: "utf8" });
  assert.equal(read.status, 0, read.stderr);

  // A word the engine hyphenated comes back in two pieces, so a break
  // after a hyphen at the end of a line is joined before the count.
  const paged = countWords(read.stdout.replace(/-\n/g, ""));
  const flowed = countWords(await epubText(bytes));
  assert.ok(flowed > 0, "the EPUB's spine prints no word");
  assert.ok(flowed <= paged, `the EPUB prints ${String(flowed)} words and the PDF ${String(paged)}`);
  assert.ok(paged - flowed <= FURNITURE, `the PDF prints ${String(paged - flowed)} words the EPUB lacks`);
});

test("the exported fixture book prints no comment, highlight mark, block id or callout marker", async () => {
  const note = await readFile(path.join(root, "fixture", "Acknowledgements.md"), "utf8");
  for (const written of ["%%Ask the readers", "==the printer's own==", " ^device", "> [!note] On the device"]) {
    assert.ok(note.includes(written), `the fixture does not hold ${written}`);
  }

  const read = spawnSync("pdftotext", [await exportedBook(vault, BOOK), "-"], { encoding: "utf8" });
  assert.equal(read.status, 0, read.stderr);
  const printed = read.stdout.replace(/-\n/g, "").replace(/\s+/g, " ");

  for (const mark of ["%%", "==", "^device", "[!"]) {
    assert.ok(!printed.includes(mark), `the book prints ${mark}`);
  }
  assert.ok(!printed.includes("Ask the readers"), "the book prints the comment");
  // The words a mark was written around are still set.
  for (const words of ["own, cut for this edition.", "On the device", "It closes every book in the series."]) {
    assert.ok(printed.includes(words), `the book does not print ${words}`);
  }
});

test("in the exported fixture book, each contents entry prints the page its chapter opens on", async () => {
  const written = await exportedBook(vault, BOOK);
  const read = spawnSync("pdftotext", ["-layout", written, "-"], { encoding: "utf8" });
  assert.equal(read.status, 0, read.stderr);
  const pages = read.stdout.split("\f").map((page) =>
    page.split("\n").map((line) => line.trim()).filter((line) => line !== ""),
  );

  const contents = pages.find((lines) => lines[0] === "Contents");
  assert.ok(contents, "no page opens on the contents");
  const entries = contents.slice(1).flatMap((line) => {
    const found = /^(.+?)\s+(\d+)$/.exec(line);
    return found?.[1] === undefined ? [] : [{ label: found[1], folio: Number(found[2]) }];
  });
  // A part heads its chapters and prints no page of its own.
  assert.ok(contents.includes("Volume the First"), "the contents lists no part");
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ["Chapter Twelve", "Chapter Fifteen"],
  );

  for (const { label, folio } of entries) {
    // An opening prints no folio, and neither does the blank page before
    // a recto. The folio an opening would print is counted back from the
    // next page that prints one.
    const opens = pages.findIndex((lines) => lines[0] === label);
    assert.ok(opens >= 0, `no page opens on ${label}`);
    const numbered = pages.findIndex(
      (lines, at) => at > opens && /^\d+$/.test(lines.at(-1) ?? ""),
    );
    assert.ok(numbered > opens, `no page after ${label} prints a folio`);
    const printed = Number(pages[numbered]?.at(-1));
    assert.equal(folio, printed - (numbered - opens), label);
  }
});

// What this tier does not cover: the face bytes of a `font` op reaching
// the engine, which the session tier tests, the cuts a family is made
// of, which belong to the font index, and what the sample's pages look
// like, which the PDF shows and no assertion here reads. The EPUB is
// counted here and not checked: `epubcheck` runs on the one the e2e
// suite exports.
