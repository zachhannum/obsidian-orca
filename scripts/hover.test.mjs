import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { root } from "./bundle.mjs";

const sheet = await readFile(path.join(root, "styles.css"), "utf8");

/** Every rule in a sheet, one per selector, with a block's rules lifted out of it. */
export function rules(css) {
  const found = [];
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declared = new Map();
    for (const line of body.split(";")) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      declared.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    for (const selector of selectors.split(",")) {
      found.push({ selector: selector.trim().replace(/\s+/g, " "), declared });
    }
  }
  return found;
}

const hides = ({ declared }) =>
  Number(declared.get("opacity")) === 0 || declared.get("visibility") === "hidden";

const shows = ({ declared }) =>
  (declared.has("opacity") && Number(declared.get("opacity")) > 0) ||
  declared.get("visibility") === "visible";

/** A selector without the pointer in it. */
const still = (selector) =>
  selector.replace(/:not\(:hover\)|:hover|:focus-within/g, "");

/**
 * The selectors a sheet draws only under a pointer: hidden where the
 * pointer is not, by a rule that says so or by one a hover rule undoes.
 */
export function hovered(css) {
  const all = rules(css);
  const found = new Set();
  for (const rule of all) {
    if (!hides(rule)) continue;
    if (rule.selector.includes(":not(:hover)")) {
      found.add(still(rule.selector));
      continue;
    }
    const undone = all.some(
      (other) =>
        other.selector.includes(":hover") &&
        still(other.selector) === rule.selector &&
        shows(other),
    );
    if (undone) found.add(rule.selector);
  }
  return [...found];
}

/** The hovered selectors no mobile rule draws. */
export function unreached(css) {
  const all = rules(css);
  return hovered(css).filter(
    (selector) =>
      !all.some(
        (rule) =>
          shows(rule) &&
          rule.selector.replace(/^(body)?\.is-mobile /, "") === selector &&
          rule.selector !== selector,
      ),
  );
}

test("a rule that hides a control until the pointer is over it is found", () => {
  const css = `
    .row .act { opacity: 0; }
    .row:hover .act, .row:focus-within .act { opacity: 1; }
    .gutter:not(:hover) .fold { visibility: hidden; }
    .page[data-empty] { visibility: hidden; }
    .cell.is-inactive { opacity: 0.42; }
  `;
  assert.deepEqual(hovered(css), [".row .act", ".gutter .fold"]);
  assert.deepEqual(unreached(css), [".row .act", ".gutter .fold"]);
  assert.deepEqual(
    unreached(`${css} .is-mobile .row .act { opacity: 1; }`),
    [".gutter .fold"],
  );
});

test("nothing orca draws on mobile is hidden until a pointer is over it", () => {
  assert.deepEqual(unreached(sheet), []);
});

test("no rule for mobile asks the device whether it can hover", () => {
  assert.doesNotMatch(sheet, /@media[^{]*\((any-)?(hover|pointer)\b/);
});

// What this tier does not cover: a control found only through a tooltip
// or a card that opens under the pointer, which the script that draws it
// decides and the e2e suite opens on a phone and a tablet.
