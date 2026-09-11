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
import {
  emptyDesign,
  type Design,
  type HeaderPosition,
  type PageNumberPosition,
} from "@/style/design";
import { generatedCss, type Setting } from "@/style/generated";
import { designSheet } from "@/style/sheet";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault, which carries a whole design. */
const BOOK = "Pride and Prejudice.md";

/** The snapshot beside this spec, which is reviewed like code. */
const SNAPSHOT = "src/style/generated.snapshot.css";

test("the fixture's design generates the sheet checked in beside this spec", async () => {
  const model = await fixture();
  // The sheet as it is sent, with the defaults under the design.
  const { css } = designSheet(model.book.design, await setting(model));

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

  // The note carries the design as the properties it was written in.
  // The CSS those properties generate is on the wire alone.
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
    // is the one slot that must reach the engine as a string, so this
    // design picks that slot.
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

    // The trim size the design sets, in points.
    assert.deepEqual(
      [...new Set(output.pages.map((page) => `${page.width}x${page.height}`))],
      ["396x612"],
    );
    // A chapter opens on a recto, which is a right-hand page. The drop
    // cap takes the first letter out of the paragraph after the title.
    const opening = output.pages.find((page) =>
      texts(page).includes("Chapter One"),
    );
    assert.equal(opening?.side, "recto");
    assert.ok(
      texts(opening).some((text) => text.startsWith("t is a truth")),
      "the drop cap left no initial behind",
    );
    // The running head names the author on a verso, which is a
    // left-hand page, and the chapter on a recto. The page a chapter
    // opens on carries neither.
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


test("a scene break sets as a blank line, an ornament or a word on its own line", () => {
  const scene = (over: Design["scene"]): string => {
    const design = emptyDesign();
    design.scene = over;
    return generatedCss(design, { roles: [] });
  };

  assert.equal(scene({ mark: "space", ornament: "\u2042" }), "hr {\n  content: none;\n}\n");
  assert.equal(
    scene({ mark: "word", word: "Later" }),
    'hr {\n  content: "Later";\n  text-align: center;\n}\n',
  );
  assert.equal(
    scene({ mark: "ornament", ornament: "\u2042" }),
    'hr {\n  content: "\u2042";\n}\n',
  );
  // A design that names no mark keeps the ornament it sets.
  assert.equal(scene({ ornament: "\u2042" }), 'hr {\n  content: "\u2042";\n}\n');
});

test("the panel's own controls generate their declarations, and the engine warns about none of them", async () => {
  const design = whole();
  const css = generatedCss(design, { roles: ROLES });

  // A heading's alignment, and the blank space around a chapter's title.
  assert.match(css, /h1 \{\n {2}text-align: center;\n\}/);
  assert.match(
    css,
    /:is\(section:nth-child\(3\), section:nth-child\(4\)\) > :is\(h1(?:, h[2-6])+\):first-child \{\n {2}padding-top: 28pt;\n {2}margin-bottom: 14pt;\n\}/,
  );
  // A heading keeps the text under it, and the paragraph after a scene
  // break takes no indent.
  assert.match(css, /:is\(h1(?:, h[2-6])+\) \{\n {2}break-after: avoid;\n\}/);
  assert.match(css, /hr \+ p \{\n {2}text-indent: 0;\n\}/);
  // The space around a scene break is counted in lines of body text.
  assert.match(css, /hr \{\n(?: {2}.+\n)* {2}margin-top: 14pt;\n {2}margin-bottom: 14pt;\n\}/);

  const output = await rendered(css);
  assert.deepEqual(output.warnings, []);
  assert.ok(output.pages.length > 0);
});

test("the first-line indent lands on a paragraph that follows another, and not on the one after a heading", async () => {
  const design = emptyDesign();
  design.body.indent = { value: 2, unit: "em" };
  const css = generatedCss(design, { roles: [] });

  assert.equal(css, "p + p {\n  text-indent: 2em;\n}\n");

  const output = await rendered(css, [INDENTED]);
  const start = (prefix: string): number => {
    const found = output.pages
      .flatMap((page) => page.items)
      .find((item) => item.kind === "text" && item.text.startsWith(prefix));
    assert.ok(found?.kind === "text", `nothing starts with \`${prefix}\``);
    return found.x;
  };
  const flush = start("Chapter");
  assert.equal(start("First"), flush);
  // The engine's body is 11pt, so 2em is 22pt.
  for (const prefix of ["Second", "Third"]) {
    assert.ok(Math.abs(start(prefix) - flush - 22) < 0.01, `\`${prefix}\` is not indented 2em`);
  }
});

test("heads at the outside corners leave a folio at the top in the center, and an opening clears all three", () => {
  const css = generatedCss(headed("outside", "top"), { roles: ["chapter"], author: "Jane Austen" });

  assert.match(css, /@page \{\n(?: {2}.+\n)* {2}@top-center \{ content: counter\(page, decimal\); \}\n/);
  assert.match(css, /@page :left \{\n {2}@top-left \{ content: "Jane Austen"; \}\n\}/);
  assert.match(css, /@page :right \{\n {2}@top-right \{ content: string\(chapter\); \}\n\}/);
  assert.match(
    css,
    /@page chapter:first \{\n {2}@top-left \{ content: none; \}\n {2}@top-center \{ content: none; \}\n {2}@top-right \{ content: none; \}\n\}/,
  );
});

test("centered heads take the center box, and push a folio at the top to the outside corners", () => {
  const css = generatedCss(headed("center", "top"), { roles: ["chapter"], author: "Jane Austen" });

  assert.match(
    css,
    /@page :left \{\n {2}@top-left \{ content: counter\(page, decimal\); \}\n {2}@top-center \{ content: "Jane Austen"; \}\n\}/,
  );
  assert.match(
    css,
    /@page :right \{\n {2}@top-center \{ content: string\(chapter\); \}\n {2}@top-right \{ content: counter\(page, decimal\); \}\n\}/,
  );
  // The root clears every box, and prints the folio in none of them.
  assert.doesNotMatch(css, /@page \{\n(?: {2}.+\n)* {2}@top-center \{ content: counter/);
  assert.match(
    css,
    /@page chapter:first \{\n {2}@top-left \{ content: none; \}\n {2}@top-center \{ content: none; \}\n {2}@top-right \{ content: none; \}\n\}/,
  );

  // A folio at the foot stays in the center, and an opening clears it
  // with the centered heads.
  const footed = generatedCss(headed("center", "bottom"), { roles: ["chapter"], author: "Jane Austen" });
  assert.match(footed, /@page :left \{\n {2}@top-center \{ content: "Jane Austen"; \}\n\}/);
  assert.match(
    footed,
    /@page chapter:first \{\n {2}@top-center \{ content: none; \}\n {2}@bottom-center \{ content: none; \}\n\}/,
  );
});

test("centered heads print in the middle of the page, with the folio at the outside corner and neither on an opening", async () => {
  const design = headed("center", "top");
  design.page.margins.top = { value: 0.8, unit: "in" };
  const { css } = designSheet(design, { roles: ROLES, author: "Jane Austen" });
  const output = await rendered(css, SOURCES);

  assert.deepEqual(output.warnings, []);
  const tops = (page: Page) =>
    page.items.flatMap((item) =>
      item.kind === "text" && item.y < TOP_MARGIN ? [item] : [],
    );
  const running = output.pages.filter((page) => tops(page).length === 2);
  assert.ok(running.some((page) => page.side === "verso"), "no verso carries a head");
  assert.ok(running.some((page) => page.side === "recto"), "no recto carries a head");
  for (const page of running) {
    const [head, folio] = partition(tops(page));
    // A run carries its left edge alone. A short head centered on the
    // page starts a little left of the middle.
    const middle = page.width / 2;
    assert.ok(head.x < middle && head.x > middle - 60, `the head on ${page.side} is off center`);
    if (page.side === "verso") assert.ok(folio.x < head.x, "the folio is not at the verso's left");
    else assert.ok(folio.x > middle, "the folio is not at the recto's right");
  }
  // An opening sets its title in the text block, under the top margin.
  const openings = output.pages.filter((page) =>
    page.items.some(
      (item) =>
        item.kind === "text" && item.y >= TOP_MARGIN && item.text.startsWith("Chapter"),
    ),
  );
  assert.equal(openings.length, 2);
  for (const page of openings) assert.deepEqual(heads(page), []);
});

test("the space above a chapter's title shows on the page, as padding over the title", async () => {
  const sunk = (lines: number) => {
    const design = emptyDesign();
    design.body.lineSpacing = { value: 14, unit: "pt" };
    design.chapter.spaceAbove = lines;
    return generatedCss(design, { roles: ["chapter"], author: "Jane Austen" });
  };
  const top = async (css: string) => {
    const output = await rendered(css, [INDENTED]);
    const found = output.pages[0]?.items.find(
      (item) => item.kind === "text" && item.text.startsWith("Chapter"),
    );
    assert.ok(found?.kind === "text", "the title did not set");
    return found.y;
  };

  assert.match(sunk(4), /:first-child \{\n {2}padding-top: 56pt;\n/);
  assert.doesNotMatch(sunk(4), /margin-top/);
  // Four lines of 14pt sink the title 56pt.
  assert.ok(Math.abs((await top(sunk(4))) - (await top(sunk(0))) - 56) < 0.01);
});

/** A design with a head on each side, placed as `position` says, and a folio. */
function headed(
  position: HeaderPosition,
  pageNumber: PageNumberPosition,
): Design {
  const design = emptyDesign();
  design.headers = {
    leftPage: "author",
    rightPage: "chapter-title",
    position,
    pageNumber,
    suppressOnOpenings: true,
  };
  return design;
}

/** The two things a page prints above its text block: the head, then the folio. */
function partition(
  items: readonly { text: string; x: number }[],
): [{ x: number }, { x: number }] {
  const folio = items.find((item) => /^\d+$/.test(item.text));
  const head = items.find((item) => !/^\d+$/.test(item.text));
  assert.ok(folio !== undefined && head !== undefined, "the page has no head and folio");
  return [head, folio];
}

/** Three short paragraphs under a heading. */
const INDENTED: Source = {
  name: "indented.md",
  text: "# Chapter One\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n",
};

/** A design that sets every field the panel offers a control for. */
function whole(): Design {
  const design = emptyDesign();
  design.body.lineSpacing = { value: 14, unit: "pt" };
  design.body.indent = { value: 1.2, unit: "em" };
  design.body.indentAfterBreak = false;
  design.body.keepHeadings = true;
  design.headings[1].align = "center";
  design.chapter.spaceAbove = 2;
  design.chapter.spaceBelow = 1;
  design.scene.mark = "word";
  design.scene.word = "Later";
  design.scene.spaceAbove = 1;
  design.scene.spaceBelow = 1;
  design.headers.leftPage = "author";
  design.headers.rightPage = "chapter-title";
  design.headers.suppressOnOpenings = true;
  return design;
}

/** A book set by the sheet handed in, two chapters unless it names its own sources. */
async function rendered(css: string, sources: Source[] = BROKEN) {
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
      { op: "dialect", dialect: "obsidian" },
      { op: "split", level: 0 },
      styleOp([{ name: "generated.css", css }]),
      { op: "book", sources },
    ]);
    assert.ok(output, "the render was overtaken");
    return output;
  } finally {
    engine.free();
  }
}

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

/** The sources of `ROLES`, with a scene break inside the last chapter. */
const BROKEN: Source[] = SOURCES.map((source, index) =>
  index === SOURCES.length - 1
    ? { ...source, text: `${source.text}\n---\n\n${sentence("She said nothing more that evening.")}` }
    : source,
);

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

/** The running head, which a page prints above its text block. */
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
// which waits on the note's css fence, and the warning a control can
// raise, which the panel's own controls answer for.
