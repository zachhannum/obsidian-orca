import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Client, createEngine, styleOp, type Op } from "fleuron";
import {
  DESIGN_KEYS,
  LEVELS,
  emptyDesign,
  readDesign,
  writeDesign,
} from "@/style/design";
import { designSheets } from "@/style/sheet";
import { DEFAULTS, effective } from "@/style/theme";

test("a book that sets nothing sets one font in two sizes, with nothing the engine warns about", async () => {
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
      styleOp(designSheets(emptyDesign(), { sections: [{ role: "chapter", id: "chapter-one" }] })),
      {
        op: "markdown",
        name: "chapter.md",
        text: "# Chapter One\n\nBody text set from the theme.\n",
      },
    ];
    const output = await client.preview(ops);
    assert.ok(output, "the render was overtaken");
    assert.deepEqual(output.warnings, []);

    const sizes = output.pages.flatMap((page) =>
      page.items.flatMap((item) => (item.kind === "text" ? [item.size] : [])),
    );
    assert.deepEqual([...new Set(sizes)].sort((a, b) => a - b), [11, 19]);

    const faces = new Set(output.fonts.map((font) => font.family));
    assert.deepEqual([...faces], ["eb garamond"]);
  } finally {
    engine.free();
  }
});

test("every design key has a default but a heading's, a head's and a folio's font, the drop cap's font, a scene break's font and size, and each font's variant", () => {
  const variant = (key: string) => key.endsWith("-font-variant");
  // A heading, a running head and a folio take the body's font, so
  // none of them carries a default of its own.
  const follows = (key: string) =>
    /^heading-\d-font$/.test(key) || key === "header-font" || key === "folio-font";
  // A scene break with no font or size of its own takes the body's, so
  // neither key has a default.
  const inherited = (key: string) =>
    key === "scene-break-font" || key === "scene-break-size";
  const optional = (key: string) =>
    follows(key) || key === "chapter-drop-cap-font" || variant(key) || inherited(key);

  assert.deepEqual(
    Object.keys(writeDesign(DEFAULTS)),
    DESIGN_KEYS.filter((key) => !optional(key)),
  );
  // The panel draws the effective design, where a heading, a drop cap,
  // a running head and a folio with no font of their own show the body
  // font. The default variant is stored as absent.
  const shown = writeDesign(effective(emptyDesign()));
  assert.deepEqual(
    Object.keys(shown),
    DESIGN_KEYS.filter((key) => !inherited(key) && !variant(key)),
  );
  for (const level of LEVELS) {
    assert.equal(shown[`heading-${level}-font`], "EB Garamond");
  }
  assert.equal(shown["chapter-drop-cap-font"], "EB Garamond");
  assert.equal(shown["header-font"], "EB Garamond");
  assert.equal(shown["folio-font"], "EB Garamond");
});

test("a book's own keys win over the defaults, and a heading follows the body font", () => {
  const design = effective(
    readDesign({
      "body-font": "Alegreya",
      "body-size": "12pt",
      "heading-2-font": "Spectral",
    }),
  );

  assert.deepEqual(design.body.size, { value: 12, unit: "pt" });
  assert.deepEqual(design.body.lineSpacing, DEFAULTS.body.lineSpacing);
  assert.equal(design.headings[1].font, "Alegreya");
  assert.equal(design.headings[2].font, "Spectral");
  // `effective` leaves the defaults as they were.
  assert.equal(DEFAULTS.body.font, "EB Garamond");
  assert.equal(DEFAULTS.headings[1].font, undefined);
});

test("a heading with no font takes the body's font and variant together, and one with its own font keeps that font's default", () => {
  const design = effective(
    readDesign({
      "body-font": "Junicode",
      "body-font-variant": "Cond",
      "heading-1-font-variant": "SemiBold",
      "heading-2-font": "Junicode",
      "heading-3-font": "Spectral",
      "heading-3-font-variant": "Light",
    }),
  );

  // A variant alone does not make a level's font its own.
  assert.equal(design.headings[1].font, "Junicode");
  assert.equal(design.headings[1].fontVariant, "Cond");
  assert.equal(design.headings[2].font, "Junicode");
  assert.equal(design.headings[2].fontVariant, undefined);
  assert.equal(design.headings[3].fontVariant, "Light");
  assert.equal(design.headings[4].fontVariant, "Cond");
  // A body with no variant leaves an inheriting level with none.
  const plain = effective(readDesign({ "heading-1-font-variant": "Cond" }));
  assert.equal(plain.headings[1].font, "EB Garamond");
  assert.equal(plain.headings[1].fontVariant, undefined);
});

test("a book that sets nothing opens a chapter on the next page, inside margins in inches, with heads at the outside", () => {
  const properties = writeDesign(DEFAULTS);

  assert.equal(properties["chapter-begins"], "next-page");
  assert.equal(properties["margin-inside"], "0.75in");
  assert.equal(properties["margin-outside"], "0.6in");
  assert.equal(properties["margin-top"], "0.75in");
  assert.equal(properties["margin-bottom"], "0.75in");
  assert.equal(properties["header-position"], "outside");
});

test("a book on the defaults declares its capitals, its tracking and its style", () => {
  const { chapter, headers, headings, scene } = DEFAULTS;

  assert.deepEqual(
    [headings[1].caps, chapter.firstLineCaps, headers.caps],
    ["normal", "normal", "normal"],
  );
  assert.deepEqual(
    [
      headings[1].letterSpacing?.value,
      chapter.firstLineLetterSpacing?.value,
      headers.letterSpacing?.value,
    ],
    [0, 0, 0],
  );
  // Every place the panel offers a style control has a default style.
  assert.deepEqual(
    [
      headings[1].style,
      chapter.dropCapStyle,
      scene.style,
      headers.style,
      headers.folioStyle,
    ],
    ["normal", "normal", "normal", "normal", "normal"],
  );

  // A control that declared nothing at its default would leave the
  // place to whatever else sets it, and the panel would go on saying
  // Normal.
  const css = designSheets(emptyDesign(), {
    sections: [{ role: "chapter", id: "chapter-one" }],
    title: "Pride and Prejudice",
  })
    .map((sheet) => sheet.css)
    .join("\n");
  assert.match(css, /h1 \{\n(?: {2}.+\n)* {2}font-variant-caps: normal;\n {2}text-transform: none;\n {2}letter-spacing: 0em;\n/);
  assert.match(css, /p::first-line,?\n?(?:.+\n)*\{?\n? {2}font-variant-caps: normal;/);
});

async function moduleBytes(): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  return readFile(require.resolve("fleuron/fleuron_bg.wasm"));
}

// What this tier does not cover: a default font other than EB Garamond,
// which is the one font the engine carries today.
