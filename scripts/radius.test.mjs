import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { root } from "./bundle.mjs";
import { rules } from "./hover.test.mjs";

const sheet = await readFile(path.join(root, "styles.css"), "utf8");
const chrome = await readFile(path.join(root, "design/chrome.css"), "utf8");

/** The rules of a sheet that take a corner from a size a theme leaves alone. */
function sized(css) {
  return rules(css)
    .filter(({ declared }) =>
      [...declared].some(
        ([property, value]) =>
          property.endsWith("radius") &&
          !property.startsWith("--touch-radius") &&
          value.includes("--touch-size"),
      ),
    )
    .map(({ selector }) => selector);
}

const corner = (selector) =>
  rules(sheet).find((rule) => rule.selector === selector)?.declared.get("border-radius");

test("no rule takes a corner from a touch size", () => {
  assert.deepEqual(sized(".a { border-radius: calc(var(--touch-size-m) - 1px); }"), [".a"]);
  assert.deepEqual(sized(sheet), []);
});

test("a chip and a pill take the pill radius, and no mobile rule sets 12px", () => {
  for (const selector of [
    ".orca-chip",
    ".is-mobile .orca-chip",
    ".orca-run",
    ".orca-preview-bar button.orca-preview-issues-count",
    ".is-mobile .orca-preview button.orca-preview-issues-count .orca-preview-pill",
  ]) {
    assert.equal(corner(selector), "var(--pill-radius)", selector);
  }
  const literal = rules(sheet).filter(
    ({ selector, declared }) =>
      selector.includes(".is-mobile") && /\b12px\b/.test(declared.get("border-radius") ?? ""),
  );
  assert.deepEqual(literal, []);
});

test("a mobile control takes the token Obsidian gives the same control", () => {
  assert.equal(corner(".is-mobile .orca-panel-segment"), "var(--input-radius)");
  assert.equal(corner(".is-mobile button.orca-panel-choice"), "var(--input-radius)");
  assert.equal(
    corner(".is-mobile .orca-panel-number.mod-ends > button.orca-panel-step"),
    "var(--input-radius)",
  );
  assert.equal(corner(".is-mobile button.orca-nav-action"), "var(--clickable-icon-radius)");
  assert.equal(corner(".is-mobile .orca-shelf"), "var(--touch-radius-xxs)");
});

test("the design's chrome carries the touch radius tokens and uses them", () => {
  for (const size of ["xxs", "xs", "s", "m", "l", "xl"]) {
    assert.ok(chrome.includes(`--touch-radius-${size}: var(--touch-size-${size});`), size);
  }
  assert.deepEqual(sized(chrome), []);
});

// What this tier does not cover: the value a token holds in Obsidian,
// which the e2e suite reads off a book's card and its actions and off
// nothing else, and a theme's own sheet, which no test loads.
