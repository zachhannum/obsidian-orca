import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDesign } from "@/style/design";
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
): Override {
  return { sheet: OWN_SHEET, line, column, property, declared, value };
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

// What this tier does not cover: an author rule on a different selector
// that wins by specificity or !important; selectors that match the same
// elements written differently, such as p ~ p, .chapter p or :where();
// a property inherited from a parent; var(); declarations inside
// conditional at-rules; columns on lines with characters outside the
// basic multilingual plane; a comment marker inside a quoted value.
