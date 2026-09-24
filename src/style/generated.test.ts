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
import { sectionIds, type Named } from "@/book/names";
import { writeNote } from "@/book/note";
import { entries, move, resolve } from "@/book/order";
import type { Role } from "@/book/roles";
import {
  DESIGN_KEYS,
  emptyDesign,
  mergeDesign,
  readDesign,
  type Design,
  type HeaderPosition,
  type PageNumberPosition,
} from "@/style/design";
import type { Registered } from "@/style/faces";
import {
  generatedCss,
  generatedRules,
  type GeneratedRule,
  type Setting,
} from "@/style/generated";
import { designRuleAt, designSheet } from "@/style/sheet";
import { DEFAULTS } from "@/style/theme";

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
  assert.equal(generatedCss(emptyDesign(), { sections: named([]) }), "");
  // The side margins take one shape, so the root `@page` carries
  // neither of them.
  const [root] = css.split("\n\n");
  assert.ok(root !== undefined && root.startsWith("@page {"));
  assert.doesNotMatch(root, /margin-(?:left|right)/);
});

test("the side margins always write `@page :left` and `@page :right`, swapped", () => {
  const design = readDesign({ "margin-inside": "1in", "margin-outside": "0.5in" });

  const css = generatedCss(design, { sections: named([]) });

  // The inside margin is at the spine, which is the right of a left
  // page and the left of a right page.
  assert.equal(
    css,
    [
      "@page :left {",
      "  margin-left: 0.5in;",
      "  margin-right: 1in;",
      "}",
      "",
      "@page :right {",
      "  margin-left: 1in;",
      "  margin-right: 0.5in;",
      "}",
      "",
    ].join("\n"),
  );
});

test("`mirrored` is no longer a design key, and a note that carries it opens with mirrored margins", () => {
  const sides = { "margin-inside": "1in", "margin-outside": "0.5in" };

  assert.ok(!DESIGN_KEYS.includes("mirrored"));
  // The key reads as nothing, so the book is the book without it and
  // the margins mirror either way.
  for (const flag of [true, false]) {
    const design = readDesign({ ...sides, mirrored: flag });
    assert.deepEqual(design, readDesign(sides));
    assert.equal(
      generatedCss(design, { sections: named([]) }),
      generatedCss(readDesign(sides), { sections: named([]) }),
    );
  }
});

test("every generated rule sits at its line, reads only real setting keys, and maps back from any line it spans", async () => {
  const model = await fixture();
  const at = await setting(model);
  const designs: Design[] = [model.book.design, emptyDesign()];
  const centered = structuredClone(model.book.design);
  centered.headers.position = "center";
  centered.headers.pageNumber = "top";
  centered.scene.mark = "ornament";
  centered.scene.font = "Junicode";
  centered.scene.size = { value: 12, unit: "pt" };
  designs.push(centered);

  for (const design of designs) {
    const { css } = designSheet(design, at);
    const lines = css.split("\n");
    const rules = generatedRules(mergeDesign(DEFAULTS, design), at);
    assert.equal(rules.map((rule) => rule.css).join("\n"), css);
    for (const rule of rules) {
      const text = lines.slice(rule.line - 1, rule.line - 1 + rule.lines).join("\n");
      assert.equal(`${text}\n`, rule.css);
      for (const key of rule.from.keys) assert.ok(DESIGN_KEYS.includes(key), key);
      for (let line = rule.line; line < rule.line + rule.lines; line++) {
        assert.deepEqual(designRuleAt(design, at, line), rule.from);
      }
      // The blank line after a rule belongs to no rule.
      assert.equal(designRuleAt(design, at, rule.line + rule.lines), undefined);
    }
  }

  // The body's rule spans many lines, and a line inside it names every
  // control the rule reads.
  const rules = generatedRules(mergeDesign(DEFAULTS, model.book.design), at);
  const book = rules.find((rule) => rule.css.startsWith("book {"));
  assert.ok(book !== undefined);
  assert.deepEqual(designRuleAt(model.book.design, at, book.line + 3), {
    keys: [
      "body-font",
      "body-size",
      "body-line-spacing",
      "body-align",
      "body-hyphens",
      "body-hanging-punctuation",
      "body-orphans",
      "body-widows",
    ],
  });
  const indent = rules.find((rule) => rule.css.startsWith("p + p {"));
  assert.deepEqual(indent?.from, { keys: ["body-first-line-indent"] });
  const chapter = rules.find((rule) => rule.css.includes("page: chapter;"));
  assert.deepEqual(chapter?.from, { keys: ["chapter-begins"], role: "chapter" });
});

test("a role reaches the sheet as a page name and as the ids of the sections that take it", async () => {
  const model = await fixture();
  const at = await setting(model);
  const css = generatedCss(model.book.design, at);

  // Each section crosses with a slug of its name as its id.
  assert.deepEqual(at.sections, [
    { role: "title-page", id: "title-page" },
    { role: "copyright", id: "copyright" },
    { role: "epigraph", id: "a-note-on-the-text" },
    { role: "contents", id: "contents" },
    { role: "part", id: "volume-the-first" },
    { role: "chapter", id: "chapter-twelve" },
    { role: "chapter", id: "chapter-fifteen" },
    { role: "back-matter", id: "acknowledgements" },
  ]);
  assert.match(css, /section#title-page \{\n {2}page: title-page;\n\}/);
  // Two sections take the chapter role, so one rule names both ids.
  assert.match(
    css,
    /:is\(section#chapter-twelve, section#chapter-fifteen\) \{\n {2}page: chapter;\n {2}break-before: recto;\n\}/,
  );
  assert.match(
    css,
    /:is\(section#chapter-twelve, section#chapter-fifteen\) > :is\(h1(?:, h[2-6])+\):first-child \+ p::first-letter,\n(?:.+,\n)*.+ \{\n {2}initial-letter: 3;\n {2}font-family: "Alegreya", serif;\n\}/,
  );
});

test("a chapter that stacks headings over its text still takes a drop cap", async () => {
  const design = emptyDesign();
  design.chapter.dropCap = 3;
  const css = generatedCss(design, { sections: named(["chapter"]) });
  const text = sentence("It is a truth universally acknowledged.");

  // A label over the title, and a label, a title and a subtitle.
  for (const opening of ["# Chapter I\n\n## A Shifting Reef", "# Chapter I\n\n## A Shifting Reef\n\n### 1866"]) {
    const output = await rendered(css, [{ name: "one.md", text: `${opening}\n\n${text}` }], named(["chapter"]));
    assert.deepEqual(output.warnings, []);
    assert.ok(
      output.pages.flatMap(texts).some((line) => line.startsWith("t is a truth")),
      `the drop cap left no initial behind under ${JSON.stringify(opening)}`,
    );
  }
});

test("the drop cap is set in the font of its own the design gives it", () => {
  const design = emptyDesign();
  design.chapter.dropCap = 3;
  design.chapter.dropCapFont = "junicode";
  const registered = [
    { font: "Junicode", variant: undefined, family: "Junicode", faces: [] },
  ];

  const css = generatedCss(design, { sections: named(["chapter"]) }, registered);
  assert.match(
    css,
    /p::first-letter \{\n {2}initial-letter: 3;\n {2}font-family: "Junicode", serif;\n\}/,
  );

  // The font sets the letter the drop cap makes, so a chapter with no
  // drop cap writes neither.
  design.chapter.dropCap = 0;
  const none = generatedCss(design, { sections: named(["chapter"]) }, registered);
  assert.doesNotMatch(none, /p::first-letter/);
});

test("the title page is set centered and down the page, with the publisher apart from the author", async () => {
  const model = await fixture();
  const sections = named(["title-page"]);
  const css = generatedCss(model.book.design, {
    sections,
    publisher: "Whitehall Press",
  });
  const output = await rendered(
    css,
    [
      {
        name: "orca-generated:0",
        text: "The Bennet Novels\n\n# Pride and Prejudice\n\nJane Austen\n\nWhitehall Press",
      },
    ],
    sections,
  );
  assert.deepEqual(output.warnings, []);

  const runs = (output.pages[0]?.items ?? []).flatMap((item) =>
    item.kind === "text" ? [item] : [],
  );
  const run = (start: string) => {
    const found = runs.find((each) => each.text.startsWith(start));
    assert.ok(found, `the title page printed no \`${start}\``);
    return found;
  };
  const [series, title, author, publisher] = [
    run("The Bennet Novels"),
    run("Pride and Prejudice"),
    run("Jane Austen"),
    run("Whitehall Press"),
  ];

  // The fixture sets its body on 14pt, and its narrowest margin is the
  // outside one. A block set flush left starts at a margin.
  const line = 14;
  const outside = 0.7 * 72;
  assert.ok(series.y > TOP_MARGIN + 6 * line, `the series sits at ${String(series.y)}`);
  // The page takes no margin, so the space the fixture sets above a
  // level 1 heading leaves the title where orca puts it.
  assert.ok(title.y - series.y < 3 * line, `the title sits at ${String(title.y)}`);
  assert.ok(publisher.y - author.y > 10 * line, "the publisher sits under the author");
  for (const each of [series, title, author, publisher]) {
    assert.ok(each.x > outside + 2 * line, `\`${each.text}\` starts at ${String(each.x)}`);
  }
});

test("a book reordered generates the sheet again, and each section keeps its id", async () => {
  const model = await fixture();
  const at = entries(model.order).findIndex((entry) => entry.role === "chapter");
  const moved = {
    ...model,
    order: move(model.order, at, { heading: "Front matter", at: 0 }),
  };

  const before = await setting(model);
  const after = await setting(moved);
  const ids = (each: Setting) => each.sections.map((section) => section.id).sort();
  const css = generatedCss(model.book.design, after);

  assert.equal(after.sections[0]?.role, "chapter");
  assert.deepEqual(ids(after), ids(before));
  assert.match(
    css,
    /:is\(section#chapter-twelve, section#chapter-fifteen\) \{\n {2}page: chapter;/,
  );
  assert.notEqual(generatedCss(model.book.design, before), css);
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
    { sections: named(ROLES), title: "Pride and Prejudice", author: "Jane Austen" },
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
      { op: "book", sources: attributed(SOURCES, named(ROLES)) },
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


test("a scene break sets as a blank line or as a glyph on its own line", () => {
  const scene = (over: Design["scene"]): string => {
    const design = emptyDesign();
    design.scene = over;
    return generatedCss(design, { sections: named([]) });
  };

  assert.equal(scene({ mark: "space", ornament: "\u2042" }), "hr {\n  content: none;\n}\n");
  assert.equal(
    scene({ mark: "ornament", ornament: "\u2042" }),
    'hr {\n  content: "\u2042";\n}\n',
  );
  // A design with no mark set keeps its ornament.
  assert.equal(scene({ ornament: "\u2042" }), 'hr {\n  content: "\u2042";\n}\n');
  // The glyph the author types is the mark, whatever it is.
  assert.equal(scene({ mark: "ornament", ornament: "*" }), 'hr {\n  content: "*";\n}\n');
});

test("a scene break set in a font of its own names that family on `hr`", () => {
  const design = emptyDesign();
  design.scene = { mark: "ornament", ornament: "\u2042", font: "Junicode" };
  const registered: Registered[] = [
    {
      font: "Junicode",
      variant: "Regular",
      family: "Junicode",
      faces: [{ url: "orca-font:junicode-regular" }],
    },
  ];

  assert.equal(
    generatedCss(design, { sections: named([]) }, registered),
    'hr {\n  font-family: "Junicode", serif;\n  content: "\u2042";\n}\n',
  );
  // A scene break with no font of its own declares none, so it takes the body's.
  design.scene.font = undefined;
  assert.equal(
    generatedCss(design, { sections: named([]) }, registered),
    'hr {\n  content: "\u2042";\n}\n',
  );
});

test("a scene break set at a size of its own writes that size on `hr`", () => {
  const design = emptyDesign();
  design.scene = { mark: "ornament", ornament: "\u2042", size: { value: 14, unit: "pt" } };

  assert.equal(
    generatedCss(design, { sections: named([]) }),
    'hr {\n  font-size: 14pt;\n  content: "\u2042";\n}\n',
  );
  // A scene break with no size of its own declares none, so it takes the body's.
  design.scene.size = undefined;
  assert.equal(
    generatedCss(design, { sections: named([]) }),
    'hr {\n  content: "\u2042";\n}\n',
  );
});

test("the panel's own controls generate their declarations, and the engine warns about none of them", async () => {
  const design = whole();
  const css = generatedCss(design, { sections: named(ROLES) });

  // A heading's alignment, and the blank space around each level.
  assert.match(css, /h1 \{\n {2}text-align: center;\n {2}margin-top: 28pt;\n {2}margin-bottom: 14pt;\n\}/);
  assert.match(css, /section > h1:first-child \{\n {2}padding-top: 28pt;\n {2}margin-top: 0;\n\}/);
  assert.match(css, /h2 \{\n {2}margin-top: 14pt;\n {2}margin-bottom: 14pt;\n\}/);
  // A heading keeps the text under it, and the paragraph after a scene
  // break takes no indent.
  assert.match(css, /:is\(h1(?:, h[2-6])+\) \{\n {2}break-after: avoid;\n\}/);
  assert.match(css, /hr \+ p \{\n {2}text-indent: 0;\n\}/);
  // The space around a scene break is in lines of body text.
  assert.match(css, /hr \{\n(?: {2}.+\n)* {2}margin-top: 14pt;\n {2}margin-bottom: 14pt;\n\}/);

  const output = await rendered(css);
  assert.deepEqual(output.warnings, []);
  assert.ok(output.pages.length > 0);
});

test("the first-line indent lands on a paragraph that follows another, and not on the one after a heading", async () => {
  const design = emptyDesign();
  design.body.indent = { value: 2, unit: "em" };
  const css = generatedCss(design, { sections: named([]) });

  assert.equal(css, "p + p {\n  text-indent: 2em;\n}\n");

  const output = await rendered(css, [INDENTED], []);
  const start =(prefix: string): number => {
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
  const css = generatedCss(headed("outside", "top"), { sections: named(["chapter"]), author: "Jane Austen" });

  assert.match(css, /@page \{\n(?: {2}.+\n)* {2}@top-center \{ content: counter\(page, decimal\); \}\n/);
  assert.match(css, /@page :left \{\n {2}@top-left \{ content: "Jane Austen"; \}\n\}/);
  assert.match(css, /@page :right \{\n {2}@top-right \{ content: string\(chapter\); \}\n\}/);
  assert.match(
    css,
    /@page chapter:first \{\n {2}@top-left \{ content: none; \}\n {2}@top-center \{ content: none; \}\n {2}@top-right \{ content: none; \}\n\}/,
  );
});

test("centered heads take the center box, and push a folio at the top to the outside corners", () => {
  const css = generatedCss(headed("center", "top"), { sections: named(["chapter"]), author: "Jane Austen" });

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
  const footed = generatedCss(headed("center", "bottom"), { sections: named(["chapter"]), author: "Jane Austen" });
  assert.match(footed, /@page :left \{\n {2}@top-center \{ content: "Jane Austen"; \}\n\}/);
  assert.match(
    footed,
    /@page chapter:first \{\n {2}@top-center \{ content: none; \}\n {2}@bottom-center \{ content: none; \}\n\}/,
  );
});

test("centered heads print in the middle of the page, with the folio at the outside corner and neither on an opening", async () => {
  const design = headed("center", "top");
  design.page.margins.top = { value: 0.8, unit: "in" };
  const { css } = designSheet(design, { sections: named(ROLES), author: "Jane Austen" });
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
    // A text run has only its left edge. A short head centered on the
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

test("a heading that opens a section takes its space above as padding, so the engine keeps it", async () => {
  const sunk = (lines: number) => {
    const design = emptyDesign();
    design.body.lineSpacing = { value: 14, unit: "pt" };
    design.headings[1].spaceAbove = lines;
    return generatedCss(design, { sections: named(["chapter"]), author: "Jane Austen" });
  };
  const top = async (css: string) => {
    const output = await rendered(css, [INDENTED], named(["chapter"]));
    const found =output.pages[0]?.items.find(
      (item) => item.kind === "text" && item.text.startsWith("Chapter"),
    );
    assert.ok(found?.kind === "text", "the title did not set");
    return found.y;
  };

  // The margin goes with the padding, so a section that opens below the
  // one before it takes the space once.
  assert.match(sunk(4), /section > h1:first-child \{\n {2}padding-top: 56pt;\n {2}margin-top: 0;\n\}/);
  // Four lines of 14pt sink the title 56pt.
  assert.ok(Math.abs((await top(sunk(4))) - (await top(sunk(0))) - 56) < 0.01);
});

test("the front matter numbers its folio in roman, and a book with no folio gets no roman rules", () => {
  const roles: Role[] = ["title-page", "copyright", "chapter", "back-matter"];
  const css = generatedCss(headed("outside", "bottom"), { sections: named(roles), author: "Jane Austen" });

  for (const role of ["title-page", "copyright"]) {
    assert.match(
      css,
      new RegExp(`@page ${role} \\{\\n {2}@bottom-center \\{ content: counter\\(page, lower-roman\\); \\}\\n\\}`),
    );
  }
  // The body keeps its own format, and a role after the body is not front matter.
  assert.match(css, /@page \{\n(?: {2}.+\n)* {2}@bottom-center \{ content: counter\(page, decimal\); \}\n/);
  assert.doesNotMatch(css, /@page (?:chapter|back-matter)(?::left|:right)? \{/);
  // The running heads are not rewritten.
  assert.doesNotMatch(css, /@top-\w+ \{ content: counter\(page, lower-roman\)/);

  const bare = headed("outside", "bottom");
  delete bare.headers.pageNumber;
  assert.doesNotMatch(generatedCss(bare, { sections: named(roles), author: "Jane Austen" }), /lower-roman/);
  // A book with no part and no chapter has no front matter.
  assert.doesNotMatch(generatedCss(headed("outside", "bottom"), { sections: named(["copyright"]) }), /lower-roman/);
});

test("a folio at the outside corner numbers the front matter in roman on each side", () => {
  const design = headed("outside", "bottom");
  design.headers.pageNumber = "outside";
  const css = generatedCss(design, { sections: named(["copyright", "chapter"]), author: "Jane Austen" });

  assert.match(css, /@page copyright:left \{\n {2}@bottom-left \{ content: counter\(page, lower-roman\); \}\n\}/);
  assert.match(css, /@page copyright:right \{\n {2}@bottom-right \{ content: counter\(page, lower-roman\); \}\n\}/);
  assert.doesNotMatch(css, /@page copyright \{/);
  // The opening's clearing comes after, and still clears the folio.
  assert.ok(css.indexOf("@page copyright:right") < css.indexOf("@page copyright:first"));
});

test("the page count starts again at the first part or chapter, and not when the body comes first", () => {
  const reset = /counter-reset: page 1;/g;
  const css = generatedCss(emptyDesign(), { sections: named(["title-page", "contents", "part", "chapter"]) });

  assert.equal(css.match(reset)?.length, 1);
  assert.match(css, /section#part-3 \{\n {2}counter-reset: page 1;\n\}/);
  assert.doesNotMatch(generatedCss(emptyDesign(), { sections: named(["chapter", "back-matter"]) }), reset);
  assert.doesNotMatch(generatedCss(emptyDesign(), { sections: named(["title-page", "copyright"]) }), reset);
});

test("the contents prints each folio in the body's folio format", () => {
  const roles: Role[] = ["title-page", "contents", "chapter"];
  const css = generatedCss(emptyDesign(), { sections: named(roles) });

  assert.match(
    css,
    /section#contents-2 p\.folio a::after \{\n {2}content: target-counter\(attr\(href url\), page, decimal\);\n\}/,
  );

  const roman = emptyDesign();
  roman.headers.pageNumberFormat = "roman";
  assert.match(generatedCss(roman, { sections: named(roles) }), /target-counter\(attr\(href url\), page, lower-roman\)/);
  assert.doesNotMatch(generatedCss(emptyDesign(), { sections: named(["chapter"]) }), /target-counter/);
});

test("the contents sets its parts, entries and folios only inside the contents", () => {
  const css = generatedCss(emptyDesign(), { sections: named(["title-page", "contents", "chapter"]) });
  const selectors = [...css.matchAll(/^([^@\s}][^{\n]*) \{$/gm)].map((match) => match[1] ?? "");

  for (const name of ["p", "p.entry", "p.folio", "p.folio a::after", "p.part"]) {
    assert.ok(selectors.includes(`section#contents-2 ${name}`), `no contents rule for ${name}`);
  }
  // Every rule on a tagged paragraph or a link sits under the contents.
  for (const selector of selectors.filter((each) => /a::after|\.part|\.entry|\.folio/.test(each))) {
    assert.ok(selector.startsWith("section#contents-2 "), `${selector} reaches past the contents`);
  }
  assert.match(css, /section#contents-2 p\.entry \{\n {2}margin-left: 1em;\n {2}padding-left: 1em;\n {2}padding-right: 3em;\n {2}text-indent: -1em;\n\}/);
});

test("a contents folio rises half a body line, and a part keeps a line above and half below", () => {
  const roles: Role[] = ["contents", "chapter"];
  const spaced = emptyDesign();
  spaced.body.lineSpacing = { value: 14, unit: "pt" };
  const css = generatedCss(spaced, { sections: named(roles) });

  assert.match(css, /section#contents-1 p\.folio \{\n(?: {2}.+\n)* {2}position: relative;\n {2}top: -7pt;\n/);
  assert.match(css, /section#contents-1 p\.part \{\n(?: {2}.+\n)* {2}margin-top: 14pt;\n {2}margin-bottom: 7pt;\n/);
  // With no line spacing set, a body line is an em.
  const bare = generatedCss(emptyDesign(), { sections: named(roles) });
  assert.match(bare, /top: -0\.5em;/);
  assert.match(bare, /margin-top: 1em;\n {2}margin-bottom: 0\.5em;/);
});

test("the contents opens on the space its own heading level sets", async () => {
  const roles: Role[] = ["contents", "chapter"];
  const sunk = (lines: number) => {
    const design = emptyDesign();
    design.body.lineSpacing = { value: 14, unit: "pt" };
    design.headings[1].spaceAbove = lines;
    design.headings[1].spaceBelow = 2;
    return generatedCss(design, { sections: named(roles) });
  };
  const title = async (css: string) => {
    const output = await rendered(css, CONTENTS, named(roles));
    const found = output.pages[0]?.items.find(
      (item) => item.kind === "text" && item.text === "Contents",
    );
    assert.ok(found?.kind === "text", "the contents title did not set");
    return found.y;
  };

  assert.match(sunk(7), /h1 \{\n {2}margin-top: 98pt;\n {2}margin-bottom: 28pt;\n\}/);
  // Seven lines of 14pt sink the title 98pt, the same as a chapter's.
  assert.ok(Math.abs((await title(sunk(7))) - (await title(sunk(0))) - 98) < 0.01);
  assert.doesNotMatch(generatedCss(emptyDesign(), { sections: named(roles) }), /padding-top/);
});

test("a contents folio sets flush right on its title's line", async () => {
  const design = emptyDesign();
  design.body.lineSpacing = { value: 14, unit: "pt" };
  const css = generatedCss(design, { sections: named(["contents", "chapter"]) });
  const output = await rendered(css, CONTENTS, named(["contents", "chapter"]));
  const items = (output.pages[0]?.items ?? []).flatMap((item) => (item.kind === "text" ? [item] : []));
  const title = items.find((item) => item.text.startsWith("Chapter"));
  const folio = items.find((item) => /^\d+$/.test(item.text));

  assert.ok(title !== undefined && folio !== undefined, "the entry did not set");
  assert.ok(Math.abs(folio.y - title.y) < 1, `the folio sits at ${folio.y}, its title at ${title.y}`);
  assert.ok(folio.x > title.x, "the folio is not right of its title");
});

/** A design with a head on each side at `position`, and a folio at `pageNumber`. */
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

/** The head and the folio a page prints above its text block, in that order. */
function partition(
  items: readonly { text: string; x: number }[],
): [{ x: number }, { x: number }] {
  const folio = items.find((item) => /^\d+$/.test(item.text));
  const head = items.find((item) => !/^\d+$/.test(item.text));
  assert.ok(folio !== undefined && head !== undefined, "the page has no head and folio");
  return [head, folio];
}

/** A contents of one entry, then the chapter it lands on. */
const CONTENTS: Source[] = [
  {
    name: "contents.md",
    text: "# Contents\n\n{.entry}\n\n[Chapter One](one.md#Chapter%20One)\n\n{.folio}\n\n[](one.md#Chapter%20One)\n",
  },
  { name: "one.md", text: "# Chapter One\n\nIt is a truth universally acknowledged.\n" },
];

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
  design.headings[1].spaceAbove = 2;
  design.headings[1].spaceBelow = 1;
  design.headings[2].spaceAbove = 1;
  design.headings[2].spaceBelow = 1;
  design.scene.mark = "ornament";
  design.scene.ornament = "\u2042";
  design.scene.font = "Junicode";
  design.scene.size = { value: 12, unit: "pt" };
  design.scene.spaceAbove = 1;
  design.scene.spaceBelow = 1;
  design.headers.leftPage = "author";
  design.headers.rightPage = "chapter-title";
  design.headers.suppressOnOpenings = true;
  return design;
}

/**
 * Sets a book with the sheet handed in. The book is two chapters unless
 * the caller passes its own sources. Each source crosses with the class
 * and id of the section at its place in `sections`.
 */
async function rendered(
  css: string,
  sources: Source[] = BROKEN,
  sections: readonly Named[] = named(ROLES),
) {
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
      { op: "book", sources: attributed(sources, sections) },
    ]);
    assert.ok(output, "the render was overtaken");
    return output;
  } finally {
    engine.free();
  }
}

/** The roles of a book long enough to turn a page inside a chapter. */
const ROLES: Role[] = ["title-page", "copyright", "chapter", "chapter"];

/** Sections of each role, with an id made of the role and its place, the way a test names them. */
function named(roles: readonly Role[]): Named[] {
  return roles.map((role, at) => ({ role, id: `${role}-${at + 1}` }));
}

/** Sources that cross with the class and id of the section at the same place. */
function attributed(sources: readonly Source[], sections: readonly Named[]): Source[] {
  return sources.map((source, at) => {
    const section = sections[at];
    return section === undefined
      ? source
      : { ...source, attributes: { classes: [section.role], id: section.id } };
  });
}

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

/** The fixture book's reading order, with the id each section crosses with. */
async function setting(model: Model): Promise<Setting> {
  const { sections } = resolve(model.order, pathLinks(await paths()), BOOK);
  const { title, author, publisher } = model.book.metadata;
  return { sections: sectionIds(sections), title, author, publisher };
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

test("a heading set in a variant names the family that variant is registered under", () => {
  const design = emptyDesign();
  design.body.font = "Junicode";
  design.headings[1].font = "junicode";
  design.headings[1].fontVariant = "cond";
  design.headings[2].font = "Spectral";
  const registered = [
    { font: "Junicode", variant: undefined, family: "Junicode", faces: [] },
    { font: "Junicode", variant: "Cond", family: "Junicode Cond", faces: [] },
  ];

  const css = generatedCss(design, { sections: named([]) }, registered);

  assert.match(css, /book \{\n {2}font-family: "Junicode", serif;/);
  assert.match(css, /h1 \{\n {2}font-family: "Junicode Cond", serif;/);
  // A font with no face registered is named as the design names it.
  assert.match(css, /h2 \{\n {2}font-family: "Spectral", serif;/);
  assert.equal(
    generatedCss(design, { sections: named([]) }, []),
    generatedCss(design, { sections: named([]) }),
  );
});

test("a heading level is set in the capitals and the tracking the design gives it", async () => {
  const design = emptyDesign();
  design.headings[1].caps = "all-caps";
  design.headings[1].letterSpacing = { value: 0.08, unit: "em" };
  const sections = named(["chapter"]);
  const rule = ruleFor(generatedRules(design, { sections }), "heading-1-caps");

  assert.equal(rule.selector, "h1");
  assert.match(
    rule.css,
    /\n {2}font-variant-caps: normal;\n {2}text-transform: uppercase;\n {2}letter-spacing: 0.08em;\n/,
  );

  const text = sentence("It is a truth universally acknowledged.");
  const output = await rendered(
    generatedCss(design, { sections }),
    [{ name: "one.md", text: `# Chapter I\n\n${text}` }],
    sections,
  );
  assert.deepEqual(output.warnings, []);
  assert.ok(output.pages.flatMap(texts).includes("CHAPTER I"));
});

test("a chapter's first line is set on its first line alone", async () => {
  const design = emptyDesign();
  design.chapter.firstLineCaps = "all-caps";
  design.chapter.firstLineLetterSpacing = { value: 0.04, unit: "em" };
  const sections = named(["chapter"]);
  const rule = ruleFor(generatedRules(design, { sections }), "chapter-first-line-caps");

  assert.match(rule.selector, /\+ p::first-line$/);
  assert.match(
    rule.css,
    /\n {2}font-variant-caps: normal;\n {2}text-transform: uppercase;\n {2}letter-spacing: 0.04em;\n/,
  );

  const text = sentence("It is a truth universally acknowledged.");
  const output = await rendered(
    generatedCss(design, { sections }),
    [{ name: "one.md", text: `# Chapter I\n\n${text}` }],
    sections,
  );
  assert.deepEqual(output.warnings, []);
  const lines = output.pages.flatMap(texts).filter((line) => /truth/i.test(line));
  const [first, ...rest] = lines;
  assert.ok(first !== undefined && first === first.toUpperCase(), "the first line is not in capitals");
  assert.ok(
    rest.some((line) => line !== line.toUpperCase()),
    "the rest of the paragraph is in capitals too",
  );
});

test("the running heads and the folio are set in the type the design gives them", async () => {
  const design = emptyDesign();
  design.headers.leftPage = "author";
  design.headers.rightPage = "book-title";
  design.headers.pageNumber = "bottom";
  design.headers.caps = "small-caps";
  design.headers.letterSpacing = { value: 0.06, unit: "em" };
  design.headers.italic = true;
  const sections = named(ROLES);
  const at = { sections, title: "Pride and Prejudice", author: "Jane Austen" };
  const css = generatedCss(design, at);

  assert.match(
    css,
    /@top-left \{ content: "Jane Austen"; font-variant-caps: small-caps; text-transform: none; letter-spacing: 0.06em; font-style: italic; \}/,
  );
  // The folio carries the same band of type as the heads.
  assert.match(
    css,
    /@bottom-center \{ content: counter\(page, decimal\); font-variant-caps: small-caps; text-transform: none; letter-spacing: 0.06em; font-style: italic; \}/,
  );
  // A page that opens a section prints none of it.
  assert.match(css, /@page chapter:first \{\n(?: {2}@[a-z-]+ \{ content: none; \}\n)+\}/);

  const output = await rendered(css, BROKEN, sections);
  assert.deepEqual(output.warnings, []);
  assert.ok(output.pages.flatMap(texts).includes("Pride and Prejudice"));
});

test("the running heads are set in the font the design gives them", () => {
  const design = headed("outside", "bottom");
  design.headers.font = "Junicode";
  const at = { sections: named(["chapter"]), author: "Jane Austen" };

  const css = generatedCss(design, at);

  assert.match(
    css,
    /@page :left \{\n {2}@top-left \{ content: "Jane Austen"; font-family: "Junicode", serif; \}\n\}/,
  );
  assert.match(
    css,
    /@page :right \{\n {2}@top-right \{ content: string\(chapter\); font-family: "Junicode", serif; \}\n\}/,
  );
  // The folio sets no font of its own, so it takes none.
  assert.match(css, /@bottom-center \{ content: counter\(page, decimal\); \}/);

  // A head set in a font a face is registered for names that family.
  const registered = [
    { font: "Junicode", variant: undefined, family: "Junicode Cond", faces: [] },
  ];
  assert.match(
    generatedCss(design, at, registered),
    /@top-left \{ content: "Jane Austen"; font-family: "Junicode Cond", serif; \}/,
  );
});

test("the folio is set in the font the design gives it", () => {
  const design = headed("outside", "bottom");
  design.headers.folioFont = "Alegreya";

  const at = { sections: named(["copyright", "chapter"]), author: "Jane Austen" };

  const css = generatedCss(design, at);

  assert.match(
    css,
    /@bottom-center \{ content: counter\(page, decimal\); font-family: "Alegreya", serif; \}/,
  );
  // The front matter numbers in roman in the same font.
  assert.match(
    css,
    /@page copyright \{\n {2}@bottom-center \{ content: counter\(page, lower-roman\); font-family: "Alegreya", serif; \}\n\}/,
  );
  // The heads set no font of their own, so they take none.
  assert.match(css, /@top-left \{ content: "Jane Austen"; \}/);
});

test("a head in the center and a folio at the outside corner each take their own font", () => {
  const design = headed("center", "top");
  design.headers.font = "Junicode";
  design.headers.folioFont = "Alegreya";

  const css = generatedCss(design, { sections: named(["chapter"]), author: "Jane Austen" });

  assert.match(
    css,
    /@page :left \{\n {2}@top-left \{ content: counter\(page, decimal\); font-family: "Alegreya", serif; \}\n {2}@top-center \{ content: "Jane Austen"; font-family: "Junicode", serif; \}\n\}/,
  );
  assert.match(
    css,
    /@page :right \{\n {2}@top-center \{ content: string\(chapter\); font-family: "Junicode", serif; \}\n {2}@top-right \{ content: counter\(page, decimal\); font-family: "Alegreya", serif; \}\n\}/,
  );
  // An opening clears all three boxes, and sets the type in none of them.
  assert.match(
    css,
    /@page chapter:first \{\n {2}@top-left \{ content: none; \}\n {2}@top-center \{ content: none; \}\n {2}@top-right \{ content: none; \}\n\}/,
  );
});

test("a design that sets every new key renders with no warning from the pinned engine", async () => {
  const design = emptyDesign();
  design.headings[1].caps = "small-caps";
  design.headings[1].letterSpacing = { value: 0.08, unit: "em" };
  design.chapter.firstLineCaps = "small-caps";
  design.chapter.firstLineLetterSpacing = { value: 0.04, unit: "em" };
  design.headers.leftPage = "author";
  design.headers.rightPage = "book-title";
  design.headers.caps = "all-caps";
  design.headers.letterSpacing = { value: 0.06, unit: "em" };
  design.headers.italic = true;
  design.headers.font = "EB Garamond";
  design.headers.folioFont = "EB Garamond";
  const sections = named(ROLES);
  const css = generatedCss(design, { sections, title: "Pride and Prejudice", author: "Jane Austen" });

  const output = await rendered(css, BROKEN, sections);

  assert.deepEqual(output.warnings, []);
});

/** The one generated rule a setting key writes. */
function ruleFor(rules: readonly GeneratedRule[], key: string): GeneratedRule {
  const found = rules.filter((rule) => rule.from.keys.includes(key));
  assert.equal(found.length, 1, `\`${key}\` writes ${found.length} rules`);
  const [rule] = found;
  assert.ok(rule);
  return rule;
}

// What this tier does not cover: the author's own layer over this one,
// which waits on the note's css fence, the warning a control can
// raise, which the panel's own controls answer for, and a slope on a
// first line, which the engine does not set.
