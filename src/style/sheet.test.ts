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
import type { Named } from "@/book/names";
import { emptyDesign, readDesign, type Design } from "@/style/design";
import { generatedCss, type Setting } from "@/style/generated";
import { readOrigin } from "@/style/origin";
import { faceCss, type Registered } from "@/style/faces";
import { DESIGN_SHEET, FACES_SHEET, OWN_SHEET, designSheet, designSheets } from "@/style/sheet";
import { BUNDLED_THEME, DEFAULTS, THEME_SHEET } from "@/style/theme";

/** A book of one chapter, which the sheets set. */
const CHAPTER: Op = {
  op: "markdown",
  name: "chapter.md",
  text: "# Chapter One\n\nBody text, long enough to break over a line.\n",
};

const SETTING: Setting = { sections: [{ role: "chapter", id: "chapter-one" }] };

/** The two chapters of `SOURCES`, by the ids they cross with. */
const CHAPTERS: Named[] = [
  { role: "chapter", id: "chapter-one" },
  { role: "chapter", id: "chapter-two" },
];

test("the layers cross in one order, and the last one to set a size wins", async () => {
  const sheets = designSheets(sized(20), SETTING, "book { font-size: 30pt; }");

  assert.deepEqual(sheets.map((sheet) => sheet.name), [
    THEME_SHEET,
    FACES_SHEET,
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
  assert.deepEqual(sheets[1], { name: FACES_SHEET, css: "" });
  assert.equal(sheets[3]?.css, "");
});

test("the registered faces cross ahead of the design that names them, and the author's CSS is sent as written", () => {
  const design = emptyDesign();
  design.body.font = "Junicode";
  design.headings[1].font = "Junicode";
  design.headings[1].fontVariant = "Cond";
  const registered: Registered[] = [
    { font: "Junicode", variant: undefined, family: "Junicode", faces: [{ url: "orca-font:a", weight: 400, italic: false }] },
    { font: "Junicode", variant: "Cond", family: "Junicode Cond", faces: [{ url: "orca-font:b", weight: 400, italic: false }] },
  ];
  const own = "h1 { font-family: \"Mine\"; }\n";

  const sheets = designSheets(design, SETTING, own, registered);

  assert.deepEqual(sheets[1], { name: FACES_SHEET, css: faceCss(registered) });
  assert.match(sheets[2]?.css ?? "", /h1 \{\n {2}font-family: "Junicode Cond", serif;/);
  assert.deepEqual(sheets[3], { name: OWN_SHEET, css: own });
});

test("a book that sets nothing gets every default in design.css", () => {
  const { css } = designSheet(emptyDesign(), SETTING);

  const expected: RegExp[] = [
    /@page \{\n {2}size: 6in 9in;\n {2}margin-top: 0\.75in;\n {2}margin-bottom: 0\.75in;\n/,
    /@page :left \{\n {2}margin-left: 0\.6in;\n {2}margin-right: 0\.75in;\n\}/,
    /@page :right \{\n {2}margin-left: 0\.75in;\n {2}margin-right: 0\.6in;\n\}/,
    /@bottom-center \{ content: counter\(page, decimal\); font-variant-caps: normal; text-transform: none; letter-spacing: 0em; font-weight: normal; font-style: normal; \}/,
    /@page chapter:first \{\n {2}@bottom-center \{ content: none; \}\n\}/,
    /book \{\n {2}font-family: "EB Garamond", serif;\n {2}font-weight: normal;\n {2}font-style: normal;\n {2}font-size: 11pt;\n {2}line-height: 16\.5pt;\n {2}text-align: justify;\n {2}hyphens: auto;\n {2}hanging-punctuation: none;\n {2}orphans: 2;\n {2}widows: 2;\n\}/,
    /p \+ p \{\n {2}text-indent: 1\.2em;\n\}/,
    /hr \+ p \{\n {2}text-indent: 0;\n\}/,
    /:is\(h1(?:, h[2-6])+\) \{\n {2}break-after: avoid;\n\}/,
    /section#chapter-one \{\n {2}page: chapter;\n {2}break-before: page;\n\}/,
    /section > h1:first-child \{\n {2}padding-top: 0pt;\n {2}margin-top: 0;\n\}/,
    /hr \{\n {2}font-weight: normal;\n {2}font-style: normal;\n {2}content: "❧";\n {2}margin-top: 16\.5pt;\n {2}margin-bottom: 16\.5pt;\n\}/,
  ];
  for (const pattern of expected) assert.match(css, pattern);
  for (const level of [1, 2, 3, 4, 5, 6]) {
    assert.match(
      css,
      new RegExp(
        `h${level} \\{\\n {2}font-weight: normal;\\n {2}font-style: normal;\\n {2}font-size: 19pt;\\n {2}font-variant-caps: normal;\\n {2}text-transform: none;\\n {2}letter-spacing: 0em;\\n {2}text-align: left;\\n {2}margin-top: 0pt;\\n {2}margin-bottom: 0pt;\\n\\}`,
      ),
    );
  }
  // A drop cap of 0 lines and a running head of none print nothing.
  assert.doesNotMatch(css, /initial-letter|@top-left \{ content: "|string\(/);
});

test("a book that sets nothing sets its text inside the default margins, and its openings carry no folio", async () => {
  const engine = await book([]);
  const orca = await book(designSheets(emptyDesign(), { sections: CHAPTERS }));

  assert.deepEqual(orca.warnings, []);
  assert.deepEqual(sides(orca.pages), sides(engine.pages));
  // The text block starts 0.75in from the gutter on a recto and 0.6in
  // from the fore-edge on a verso.
  for (const page of orca.pages) {
    const x = firstX(page) ?? Number.NaN;
    const margin = page.side === "recto" ? 54 : 43.2;
    assert.ok(Math.abs(x - margin) < 0.01, `a ${page.side} starts at ${x}`);
  }
  // The page a chapter opens on carries no folio.
  const openings = orca.pages.filter((page) =>
    texts(page).some((text) => text.startsWith("Chapter")),
  );
  assert.equal(openings.length, 2);
  for (const page of openings) assert.equal(folio(page), undefined);
  assert.ok(orca.pages.some((page) => folio(page) !== undefined));
});

test("the front matter prints a roman folio, and the body counts again from 1", async () => {
  const design = emptyDesign();
  design.headers.pageNumber = "bottom";
  const output = await rendered([
    { op: "dialect", dialect: "obsidian" },
    { op: "split", level: 0 },
    styleOp(
      designSheets(design, {
        sections: [
          { role: "copyright", id: "copyright" },
          { role: "chapter", id: "chapter-one" },
        ],
      }),
    ),
    {
      op: "book",
      sources: [
        {
          name: "copyright.md",
          text: `# Copyright\n\n${PARAGRAPH}\n\n${PARAGRAPH}\n\n${PARAGRAPH}\n`,
          attributes: { classes: ["copyright"], id: "copyright" },
        },
        {
          name: "one.md",
          text: `# Chapter One\n\n${PARAGRAPH}\n\n${PARAGRAPH}\n`,
          attributes: { classes: ["chapter"], id: "chapter-one" },
        },
      ],
    },
  ]);

  assert.deepEqual(output.warnings, []);
  const opening = output.pages.findIndex((page) => texts(page).includes("Chapter One"));
  assert.ok(opening > 1, "the copyright did not turn a page");
  const front = output.pages.slice(0, opening).map(folioText);
  assert.ok(front.includes("ii"), `the front matter printed ${JSON.stringify(front)}`);
  assert.equal(folioText(output.pages[opening + 1]), "2");
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

test("a declaration the engine cannot set in book.css is reported at its own line and column in that sheet", async () => {
  const own = "/* mine */\np {\n  float: left;\n}\n";
  const output = await set(designSheets(emptyDesign(), SETTING, own));

  const places = output.warnings.flatMap((warning) =>
    warning.origin === null ? [] : [readOrigin(warning.origin)],
  );
  assert.deepEqual(places, [{ sheet: OWN_SHEET, line: 3, column: 3 }]);
  assert.ok(output.pages.length > 0);
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
  {
    name: "one.md",
    text: `# Chapter One\n\n${PARAGRAPH}\n\n${PARAGRAPH}\n`,
    attributes: { classes: ["chapter"], id: "chapter-one" },
  },
  {
    name: "two.md",
    text: `# Chapter Two\n\n${PARAGRAPH}\n`,
    attributes: { classes: ["chapter"], id: "chapter-two" },
  },
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

/** The folio's text alone. */
function folioText(page: Page | undefined): string | undefined {
  return page === undefined ? undefined : folio(page)?.split(" at ")[0];
}

/** The default bottom margin, in points. Anything below it is a margin box. */
const BOTTOM_MARGIN = 54;

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: a warning in the author's own layer
// on any declaration but one. It also does not cover a folio at the
// top or the outside edge. Orca clears the openings for
// those the same way.
