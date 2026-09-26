import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDesign } from "@/style/design";
import { generatedRules, type Setting } from "@/style/generated";
import { designOverridden, type Override } from "@/style/overrides";
import { OWN_SHEET } from "@/style/sheet";

const SETTING = { sections: [] };

function beaten(css: string, refused: readonly { line: number; column: number }[] = []) {
  return Object.fromEntries(designOverridden(emptyDesign(), SETTING, css, [], refused));
}

function at(
  line: number,
  column: number,
  property: string,
  value: string,
  declared = property,
  important = false,
): Override {
  return { sheet: OWN_SHEET, line, column, property, declared, value, important };
}

test("the overrides layer beats a generated declaration of the same property under the same selector, and names the line that beat it", () => {
  assert.deepEqual(beaten("p {}\n\np + p {\n  text-indent: 0;\n}\n"), {
    "body-first-line-indent": at(4, 3, "text-indent", "0"),
  });

  // Only the declaration's own key, though the rule sets other properties.
  assert.deepEqual(beaten("book { line-height: 1.5; }"), {
    "body-line-spacing": at(1, 8, "line-height", "1.5"),
  });

  // The inside and outside margins sit on the :left and :right pages.
  assert.deepEqual(beaten("@page {\n  margin: 1in   2in;\n}"), {
    "margin-top": at(2, 3, "margin-top", "1in 2in", "margin"),
    "margin-bottom": at(2, 3, "margin-bottom", "1in 2in", "margin"),
  });

  // The value keeps its case and its spaces, less comments and runs of whitespace.
  assert.deepEqual(beaten("H1,\n  h2 { font-size: calc(1em + /* a */ 2PT) }"), {
    "heading-1-size": at(2, 8, "font-size", "calc(1em + 2PT)"),
    "heading-2-size": at(2, 8, "font-size", "calc(1em + 2PT)"),
  });

  assert.deepEqual(beaten("@page {\n  @bottom-center { content: none; }\n}"), {
    "page-number-position": at(2, 20, "content", "none"),
    "page-number-format": at(2, 20, "content", "none"),
  });

  const unbeaten = [
    "p { text-indent: 0; }",
    ".chapter-opening h1 { font-size: 20pt; }",
    "@media print { p + p { text-indent: 0; } book { line-height: 2; } }",
    "@page :left { @bottom-center { content: none; } }",
  ];
  for (const css of unbeaten) assert.deepEqual(beaten(css), {}, css);

  // Neither the brace in the comment nor the one in the string moves a line.
  const braces = '/* { */\nh1::before { content: "}"; }\n\np + p { text-indent: 0; }\n';
  assert.deepEqual(beaten(braces), {
    "body-first-line-indent": at(4, 9, "text-indent", "0"),
  });

  const twice = "p + p {\n  text-indent: 0;\n  text-indent: 2em;\n}\n";
  assert.deepEqual(beaten(twice), { "body-first-line-indent": at(3, 3, "text-indent", "2em") });
  assert.deepEqual(beaten(twice, [{ line: 3, column: 3 }]), {
    "body-first-line-indent": at(2, 3, "text-indent", "0"),
  });
});

test("an author rule beats the capitals and the tracking a control sets, and names the line that beat it", () => {
  const design = emptyDesign();
  design.chapter.firstLineCaps = "small-caps";
  design.headers.leftPage = "author";
  design.headers.letterSpacing = { value: 0.06, unit: "em" };
  const setting: Setting = {
    sections: [{ role: "chapter", id: "chapter-one" }],
    author: "Jane Austen",
  };
  const rules = generatedRules(design, setting);
  const firstLine = rules.find((rule) => rule.selector.includes("::first-line"));
  assert.ok(firstLine);

  const css = `${firstLine.selector} {\n  font-variant-caps: normal;\n}\n\n@page :left {\n  @top-left { letter-spacing: 0; }\n}\n`;
  const beaten = Object.fromEntries(designOverridden(design, setting, css, [], []));

  assert.deepEqual(Object.keys(beaten).sort(), [
    "chapter-first-line-caps",
    "header-letter-spacing",
  ]);
  assert.deepEqual(beaten["header-letter-spacing"], at(8, 15, "letter-spacing", "0"));

  // A row at its default declares that default, so it is beaten the
  // same way a row the book sets is.
  const beatenDefault = designOverridden(
    emptyDesign(),
    setting,
    `${firstLine.selector} {\n  font-variant-caps: small-caps;\n}\n`,
  );
  assert.deepEqual([...beatenDefault.keys()], ["chapter-first-line-caps"]);
});

test("an !important author declaration beats a generated one on every element it matches, from any selector", () => {
  assert.deepEqual(beaten("p {\n  text-indent: 0 !important;\n}\n"), {
    "body-first-line-indent": at(2, 3, "text-indent", "0", "text-indent", true),
    "body-indent-after-break": at(2, 3, "text-indent", "0", "text-indent", true),
  });

  // p ~ p matches every p + p, but not the paragraph after a break.
  assert.deepEqual(beaten("p ~ p { text-indent: 0 !important; }"), {
    "body-first-line-indent": at(1, 9, "text-indent", "0", "text-indent", true),
  });
  assert.deepEqual(beaten("h1, h2 { font-size: 20pt !important; }\n*::before { content: none; }"), {
    "heading-1-size": at(1, 10, "font-size", "20pt", "font-size", true),
    "heading-2-size": at(1, 10, "font-size", "20pt", "font-size", true),
  });

  // An important declaration beats a later normal one under the generated selector.
  assert.deepEqual(beaten("p ~ p { text-indent: 1em !important; }\np + p { text-indent: 0; }"), {
    "body-first-line-indent": at(1, 9, "text-indent", "1em", "text-indent", true),
  });

  // An important @page rule reaches the margin boxes of the left and right pages.
  const design = emptyDesign();
  design.headers.leftPage = "author";
  design.headers.letterSpacing = { value: 0.06, unit: "em" };
  const setting: Setting = { sections: [], author: "Jane Austen" };
  const headers = Object.fromEntries(
    designOverridden(design, setting, "@page {\n  @top-left { letter-spacing: 0 !important; }\n}\n"),
  );
  assert.deepEqual(headers["header-letter-spacing"], at(2, 15, "letter-spacing", "0", "letter-spacing", true));
});

test("a control whose generated declaration still wins stays live", () => {
  const live = [
    // Not important, and a selector the generated rule does not carry.
    "p { text-indent: 0; }",
    // Important, but it matches only some of the elements the generated rule sets.
    ".chapter p + p { text-indent: 0 !important; }",
    "p > p { text-indent: 0 !important; }",
    "h1 { font-size: 20pt !important; }",
    "p { font-variant-caps: normal !important; }",
    "@page :left { @bottom-center { content: none !important; } }",
    // Important, but under a conditional at-rule.
    "@media print { p { text-indent: 0 !important; } }",
  ];
  for (const css of live) {
    const keys = Object.keys(beaten(css));
    assert.ok(!keys.includes("body-first-line-indent"), css);
    assert.ok(!keys.includes("heading-2-size"), css);
    assert.ok(!keys.includes("page-number-position"), css);
  }
});

// What this tier does not cover: an author rule on a different selector
// that wins by specificity; selectors that match the same elements
// written differently without !important, such as p ~ p or :where();
// which of two !important author declarations wins by specificity; a
// property inherited from a parent; var(); declarations inside
// conditional at-rules; columns on lines with characters outside the
// basic multilingual plane; a comment marker inside a quoted value.
