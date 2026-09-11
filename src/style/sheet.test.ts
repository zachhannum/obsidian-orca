import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  Client,
  createEngine,
  styleOp,
  type Op,
  type Page,
  type Sheet,
  type Source,
} from "fleuron";
import { emptyDesign, readDesign, type Design } from "@/style/design";
import { generatedCss } from "@/style/generated";
import { DESIGN_SHEET, OWN_SHEET, designSheet, designSheets } from "@/style/sheet";
import { BUNDLED_THEME, DEFAULTS, THEME_SHEET } from "@/style/theme";

/** A book of one chapter, which the sheets set. */
const CHAPTER: Op = {
  op: "markdown",
  name: "chapter.md",
  text: "# Chapter One\n\nBody text, long enough to break over a line.\n",
};

const SETTING = { roles: ["chapter"] } as const;

test("the three layers cross in one order, and the last one to set a size wins", async () => {
  const sheets = designSheets(sized(20), SETTING, "book { font-size: 30pt; }");

  assert.deepEqual(sheets.map((sheet) => sheet.name), [
    THEME_SHEET,
    DESIGN_SHEET,
    OWN_SHEET,
  ]);
  // The defaults set 11pt, the design 20pt and the author 30pt, so each
  // setting beats the one under it.
  assert.equal(await bodySize(sheets), 30);
  assert.equal(await bodySize(designSheets(sized(20), SETTING)), 20);
  assert.equal(await bodySize(designSheets(emptyDesign(), SETTING)), 11);
});

test("a design that settles nothing generates the defaults, over the theme", () => {
  const sheets = designSheets(emptyDesign(), SETTING);

  assert.deepEqual(sheets[0], { name: THEME_SHEET, css: BUNDLED_THEME });
  assert.equal(designSheet(emptyDesign(), SETTING).css, generatedCss(DEFAULTS, SETTING));
  assert.equal(sheets[2]?.css, "");
});

test("a book that sets nothing gets every default in design.css", () => {
  const { css } = designSheet(emptyDesign(), SETTING);

  const expected: RegExp[] = [
    /@page \{\n {2}size: 6in 9in;\n {2}margin-top: 54pt;\n {2}margin-bottom: 54pt;\n/,
    /@page :left \{\n {2}margin-left: 42pt;\n {2}margin-right: 54pt;\n\}/,
    /@page :right \{\n {2}margin-left: 54pt;\n {2}margin-right: 42pt;\n\}/,
    /@bottom-center \{ content: counter\(page, decimal\); \}/,
    /@page chapter:first \{\n {2}@bottom-center \{ content: none; \}\n\}/,
    /book \{\n {2}font-family: "EB Garamond", serif;\n {2}font-size: 11pt;\n {2}line-height: 16\.5pt;\n {2}text-align: justify;\n {2}hyphens: auto;\n {2}hanging-punctuation: none;\n {2}orphans: 2;\n {2}widows: 2;\n\}/,
    /p \+ p \{\n {2}text-indent: 1\.2em;\n\}/,
    /hr \+ p \{\n {2}text-indent: 0;\n\}/,
    /:is\(h1(?:, h[2-6])+\) \{\n {2}break-after: avoid;\n\}/,
    /section:nth-child\(1\) \{\n {2}page: chapter;\n {2}break-before: recto;\n\}/,
    /:first-child \{\n {2}margin-top: 0pt;\n {2}margin-bottom: 0pt;\n\}/,
    /hr \{\n {2}content: "❧";\n {2}margin-top: 16\.5pt;\n {2}margin-bottom: 16\.5pt;\n\}/,
  ];
  for (const pattern of expected) assert.match(css, pattern);
  for (const level of [1, 2, 3, 4, 5, 6]) {
    assert.match(css, new RegExp(`h${level} \\{\\n {2}font-size: 19pt;\\n {2}text-align: left;\\n\\}`));
  }
  // A drop cap of 0 lines and a running head of none print nothing.
  assert.doesNotMatch(css, /initial-letter|@top-left \{ content: "|string\(/);
});

test("a book that sets nothing keeps the engine's pages, and its openings carry no folio", async () => {
  const engine = await book([]);
  const orca = await book(designSheets(emptyDesign(), { roles: ["chapter", "chapter"] }));

  assert.deepEqual(orca.warnings, []);
  assert.deepEqual(sides(orca.pages), sides(engine.pages));
  // The text block starts where the engine's own margins put it, on
  // both sides of the spread.
  assert.deepEqual(orca.pages.map(firstX), engine.pages.map(firstX));
  // The folio sits where the engine puts it, and leaves the page a
  // chapter opens on.
  assert.deepEqual(orca.pages.map(folio), engine.pages.map(folio));
  const openings = orca.pages.filter((page) =>
    texts(page).some((text) => text.startsWith("Chapter")),
  );
  assert.equal(openings.length, 2);
  for (const page of openings) assert.equal(folio(page), undefined);
  assert.ok(orca.pages.some((page) => folio(page) !== undefined));
});

test("a book set in a font the engine does not have still sets, and warns about none of it", async () => {
  const design = emptyDesign();
  design.body.font = "Nonesuch";
  const output = await set(designSheets(design, SETTING));

  // The engine falls back to the font it carries without a warning,
  // so a font the author does not have is orca's to report.
  assert.deepEqual(output.warnings, []);
  assert.ok(output.pages.length > 0);
  assert.deepEqual([...new Set(output.fonts.map((font) => font.family))], [
    "eb garamond",
  ]);
});

test("a preset a note still names is ignored by the design", () => {
  const named = readDesign({ preset: "Quarto" });

  assert.deepEqual(named, emptyDesign());
  assert.deepEqual(designSheets(named, SETTING), designSheets(emptyDesign(), SETTING));
});

function sized(points: number): Design {
  const design = emptyDesign();
  design.body.size = { value: points, unit: "pt" };
  return design;
}

/** The size the chapter's body text is set in. */
async function bodySize(sheets: Sheet[]): Promise<number | undefined> {
  const output = await set(sheets);
  const found = output.pages.flatMap((page) =>
    page.items.flatMap((item) =>
      item.kind === "text" && item.text.startsWith("Body") ? [item.size] : [],
    ),
  );
  return found[0];
}

async function set(sheets: Sheet[]) {
  return rendered([{ op: "dialect", dialect: "obsidian" }, styleOp(sheets), CHAPTER]);
}

/** Two chapters, each long enough to turn a page. */
async function book(sheets: Sheet[]) {
  return rendered([
    { op: "dialect", dialect: "obsidian" },
    { op: "split", level: 0 },
    styleOp(sheets),
    { op: "book", sources: SOURCES },
  ]);
}

async function rendered(ops: Op[]) {
  const engine = await createEngine({ wasm: await moduleBytes() });
  try {
    const client: Client = new Client({
      post: (request) => {
        engine.submit(request, (response) => {
          client.receive(response);
        });
      },
    });
    const output = await client.preview(ops);
    assert.ok(output, "the render was overtaken");
    return output;
  } finally {
    engine.free();
  }
}

const PARAGRAPH = "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. ".repeat(20);

const SOURCES: Source[] = [
  { name: "one.md", text: `# Chapter One\n\n${PARAGRAPH}\n\n${PARAGRAPH}\n` },
  { name: "two.md", text: `# Chapter Two\n\n${PARAGRAPH}\n` },
];

function texts(page: Page): string[] {
  return page.items.flatMap((item) => (item.kind === "text" ? [item.text] : []));
}

function sides(pages: readonly Page[]): string[] {
  return pages.map((page) => `${page.side} ${page.width}x${page.height}`);
}

/** The left edge of the first thing a page prints. */
function firstX(page: Page): number | undefined {
  const first = page.items.find((item) => item.kind === "text");
  return first?.kind === "text" ? first.x : undefined;
}

/** The folio, which a page prints under its text block. */
function folio(page: Page): string | undefined {
  const found = page.items.find(
    (item) => item.kind === "text" && item.y > page.height - BOTTOM_MARGIN,
  );
  return found?.kind === "text" ? `${found.text} at ${found.x.toFixed(1)}` : undefined;
}

/** The engine's bottom margin, in points. Anything below it is a margin box. */
const BOTTOM_MARGIN = 54;

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: the author's own layer with anything
// in it, which waits on the note's css fence, and a folio at the top
// or the outside edge, whose openings are cleared the same way.
