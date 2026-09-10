import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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
  type Source,
} from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel, type Model } from "@/book/model";
import { writeNote } from "@/book/note";
import { entries, move, resolve } from "@/book/order";
import { sentRoles } from "@/book/plan";
import type { Role } from "@/book/roles";
import { emptyDesign } from "@/style/design";
import { generatedCss, type Setting } from "@/style/generated";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault, which carries a whole design. */
const BOOK = "Pride and Prejudice.md";

/** The snapshot beside this spec, which is reviewed like code. */
const SNAPSHOT = "src/style/generated.snapshot.css";

test("the fixture's design generates the sheet checked in beside this spec", async () => {
  const model = await fixture();
  const css = generatedCss(model.book.design, await setting(model));

  assert.equal(css, await snapshot(css));
  assert.equal(generatedCss(emptyDesign(), { roles: [] }), "");
});

test("a role reaches the sheet as a page name and as the places it sits", async () => {
  const model = await fixture();
  const roles = await setting(model);
  const css = generatedCss(model.book.design, roles);

  // The fixture opens on a title page, and its one chapter is the
  // sixth section of seven.
  assert.deepEqual(roles.roles, [
    "title-page",
    "copyright",
    "epigraph",
    "contents",
    "part",
    "chapter",
    "back-matter",
  ]);
  assert.match(css, /section:nth-child\(1\) \{\n {2}page: title-page;\n\}/);
  assert.match(
    css,
    /section:nth-child\(6\) \{\n {2}page: chapter;\n {2}break-before: recto;\n\}/,
  );
  assert.match(
    css,
    /section:nth-child\(6\) > :is\(h1(?:, h[2-6])+\):first-child \+ p::first-letter \{\n {2}initial-letter: 3;\n\}/,
  );
});

test("a book reordered generates the sheet again, and the sheet counts the new order", async () => {
  const model = await fixture();
  const at = entries(model.order).findIndex((entry) => entry.role === "chapter");
  const moved = {
    ...model,
    order: move(model.order, at, { heading: "Front matter", at: 0 }),
  };

  const before = generatedCss(model.book.design, await setting(model));
  const after = generatedCss(model.book.design, await setting(moved));

  assert.equal((await setting(moved)).roles.indexOf("chapter"), 0);
  assert.match(after, /section:nth-child\(1\) \{\n {2}page: chapter;/);
  assert.notEqual(before, after);
});

test("the layer a design generates is not in the note the design is written in", async () => {
  const model = await fixture();
  const css = generatedCss(model.book.design, await setting(model));
  const note = writeNote(model.book, "# Body\n\n- [[Chapter Twelve]]\n");

  // The design is in the note as the properties it was written as, and
  // the CSS those properties generate is on the wire alone.
  assert.match(note, /^trim: 5\.5in 8\.5in$/m);
  for (const line of css.split("\n").filter((each) => each.trim() !== "")) {
    assert.ok(!note.includes(line.trim()), `the note carries \`${line.trim()}\``);
  }
});

test("the generated layer sets the pages it describes, and the engine warns about none of it", async () => {
  const model = await fixture();
  const { design } = model.book;
  const css = generatedCss(
    // The fixture names the book on a right-hand page. A chapter title
    // is the slot that has to reach the engine as a string, so this is
    // the design with that slot picked.
    { ...design, headers: { ...design.headers, rightPage: "chapter-title" } },
    { roles: ROLES, title: "Pride and Prejudice", author: "Jane Austen" },
  );

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
      styleOp([{ name: "generated.css", css }]),
      { op: "book", sources: SOURCES },
    ];
    const output = await client.preview(ops);

    assert.ok(output, "the render was overtaken");
    assert.deepEqual(output.warnings, []);

    // The trim the design asked for, in points.
    assert.deepEqual(
      [...new Set(output.pages.map((page) => `${page.width}x${page.height}`))],
      ["396x612"],
    );
    // A chapter opens on a recto, and the drop cap takes the first
    // letter out of the paragraph that follows the title.
    const opening = output.pages.find((page) =>
      texts(page).includes("Chapter One"),
    );
    assert.equal(opening?.side, "recto");
    assert.ok(
      texts(opening).some((text) => text.startsWith("t is a truth")),
      "the drop cap left no initial behind",
    );
    // The running head names the author on a verso and the chapter on
    // a recto, and neither on the page a chapter opens.
    assert.deepEqual(heads(opening), []);
    const running = output.pages.flatMap((page) =>
      page.side === "verso" ? heads(page) : [],
    );
    assert.ok(running.includes("Jane Austen"));
    assert.ok(
      output.pages
        .flatMap((page) => (page.side === "recto" ? heads(page) : []))
        .includes("Chapter One"),
    );
  } finally {
    engine.free();
  }
});

/** The roles of a book long enough to turn a page inside a chapter. */
const ROLES: Role[] = ["title-page", "copyright", "chapter", "chapter"];

const SOURCES: Source[] = [
  { name: "title.md", text: "# Pride and Prejudice\n\nJane Austen\n" },
  { name: "copyright.md", text: "# Copyright\n\nWhitehall Press.\n" },
  {
    name: "one.md",
    text: `# Chapter One\n\n${sentence("It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.")}`,
  },
  {
    name: "two.md",
    text: `# Chapter Two\n\n${sentence("Mr Bennet was so odd a mixture of quick parts, sarcastic humour, reserve, and caprice.")}`,
  },
];

function sentence(text: string): string {
  return `${text} `.repeat(60);
}

async function fixture(): Promise<Model> {
  return readModel(await readText(vault, BOOK));
}

/** The fixture book's reading order, as the generated layer counts it. */
async function setting(model: Model): Promise<Setting> {
  const { sections } = resolve(model.order, pathLinks(await paths()), BOOK);
  const { title, author } = model.book.metadata;
  return { roles: sentRoles(sections), title, author };
}

async function paths(folder = "/"): Promise<string[]> {
  const { files, folders } = await vault.list(folder);
  const under = await Promise.all(folders.map((at) => paths(at)));
  return [...files, ...under.flat()];
}

/**
 * The snapshot as it is on disk, written first when `ORCA_SNAPSHOTS` is
 * set. A snapshot is read like code, so it is updated on purpose.
 */
async function snapshot(css: string): Promise<string> {
  const file = path.join(root, SNAPSHOT);
  if (process.env["ORCA_SNAPSHOTS"] !== undefined) await writeFile(file, css);
  return readFile(file, "utf8");
}

/** Everything a page prints, the margin boxes included. */
function texts(page: Page | undefined): string[] {
  return (page?.items ?? []).flatMap((item) =>
    item.kind === "text" ? [item.text] : [],
  );
}

/** The running head: what a page prints above its text block. */
function heads(page: Page | undefined): string[] {
  return (page?.items ?? []).flatMap((item) =>
    item.kind === "text" && item.y < TOP_MARGIN ? [item.text] : [],
  );
}

/** The fixture's top margin, in points. Anything above it is a margin box. */
const TOP_MARGIN = 0.8 * 72;

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: the author's own layer over this one,
// which waits on the note's css fence, and the warning a control could
// raise, which the panel's own controls answer for.
