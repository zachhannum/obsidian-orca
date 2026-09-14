/**
 * The generated declarations the author's own sheet beats. It compares
 * names only: selectors, page preludes, margin boxes and properties.
 * Whether a value is valid is the engine's to say, so a declaration the
 * engine refused is passed in and never counts.
 */

import { parser } from "@lezer/css";
import { mergeDesign, type Design } from "@/style/design";
import type { Registered } from "@/style/faces";
import { generatedRules, type GeneratedRule, type Setting } from "@/style/generated";
import type { Place } from "@/style/origin";
import { OWN_SHEET } from "@/style/sheet";
import { DEFAULTS } from "@/style/theme";

type SyntaxNode = ReturnType<typeof parser.parse>["topNode"];

/**
 * One declaration of the author's sheet, at the place the engine would
 * name it. `selectors` and `page` are normalized. `page` is the prelude
 * of the `@page` rule it sits in, and `selectors` is empty there.
 */
export interface OwnDeclaration {
  selectors: readonly string[];
  page: string | undefined;
  box: string | undefined;
  property: string;
  /** The value as written, with its whitespace collapsed. */
  value: string;
  line: number;
  column: number;
}

/** The author declaration that beats a generated one, at its place. */
export interface Override extends Place {
  /** The generated property it beats, a longhand when `declared` is a shorthand. */
  property: string;
  declared: string;
  value: string;
}

/** The longhands each shorthand sets that a generated rule can declare. */
const SHORTHANDS: Readonly<Record<string, readonly string[]>> = {
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  font: [
    "font-family",
    "font-size",
    "line-height",
    "font-style",
    "font-weight",
    "font-variant",
    "font-stretch",
  ],
};

/**
 * The declarations of top-level rules and page rules, in source order.
 * Declarations inside any other at-rule are left out, since whether
 * they apply depends on more than a name.
 */
export function ownDeclarations(css: string): OwnDeclaration[] {
  const starts = lineStarts(css);
  const found: OwnDeclaration[] = [];
  const read = (
    block: SyntaxNode,
    context: { selectors: readonly string[]; page: string | undefined; box: string | undefined },
  ) => {
    for (let child = block.firstChild; child !== null; child = child.nextSibling) {
      if (child.name === "Declaration") {
        const name = child.firstChild;
        if (name === null) continue;
        const { line, column } = placeOf(starts, name.from);
        const colon = css.indexOf(":", name.to);
        const value =
          colon === -1 || colon >= child.to
            ? ""
            : withoutComments(css.slice(colon + 1, child.to))
                .replace(/;\s*$/, "")
                .replace(/\s+/g, " ")
                .trim();
        found.push({ ...context, property: nameOf(css, name), value, line, column });
      } else if (child.name === "AtRule" && context.page !== undefined && context.box === undefined) {
        const keyword = child.getChild("AtKeyword");
        const inner = child.getChild("Block");
        if (keyword === null || inner === null) continue;
        read(inner, { ...context, box: css.slice(keyword.from + 1, keyword.to).toLowerCase() });
      }
    }
  };
  const top = parser.parse(css).topNode;
  for (let item = top.firstChild; item !== null; item = item.nextSibling) {
    const block = item.getChild("Block");
    if (block === null) continue;
    if (item.name === "RuleSet") {
      const selectors = selectorList(css.slice(item.from, block.from));
      read(block, { selectors, page: undefined, box: undefined });
    } else if (item.name === "AtRule") {
      const keyword = item.getChild("AtKeyword");
      if (keyword === null || css.slice(keyword.from, keyword.to).toLowerCase() !== "@page") {
        continue;
      }
      const page = normalized(css.slice(keyword.to, block.from));
      read(block, { selectors: [], page, box: undefined });
    }
  }
  return found;
}

/**
 * Each design key a generated declaration reads, mapped to the author
 * declaration that beats it. A declaration is beaten in the same
 * context, top level or the same page prelude and margin box, when the
 * author's selector list holds every selector of the generated list and
 * the property is the same or a shorthand of it. The last such author
 * declaration wins. A declaration at a refused place never counts.
 */
export function overridden(
  rules: readonly GeneratedRule[],
  own: readonly OwnDeclaration[],
  refused: readonly { line: number; column: number }[] = [],
): ReadonlyMap<string, Override> {
  const counted = own.filter(
    (mine) => !refused.some((place) => place.line === mine.line && place.column === mine.column),
  );
  const beaten = new Map<string, Override>();
  for (const rule of rules) {
    const page = pagePrelude(rule.selector);
    const selectors = page === undefined ? selectorList(rule.selector) : [];
    for (const declaration of rule.declarations) {
      const winner = counted
        .filter(
          (mine) =>
            (page === undefined
              ? mine.page === undefined &&
                selectors.every((selector) => mine.selectors.includes(selector))
              : mine.page === page && mine.box === declaration.box) &&
            (mine.property === declaration.property ||
              (SHORTHANDS[mine.property]?.includes(declaration.property) ?? false)),
        )
        .at(-1);
      if (winner === undefined) continue;
      const place: Override = {
        sheet: OWN_SHEET,
        line: winner.line,
        column: winner.column,
        property: declaration.property,
        declared: winner.property,
        value: winner.value,
      };
      for (const key of declaration.keys) {
        const earlier = beaten.get(key);
        if (earlier === undefined || before(earlier, place)) beaten.set(key, place);
      }
    }
  }
  return beaten;
}

/**
 * `overridden` for a design and the author's sheet. It merges the
 * defaults the same way as `designSheet`, so the keys are those of the
 * sheet the engine was sent.
 */
export function designOverridden(
  design: Design,
  setting: Setting,
  css: string,
  registered: readonly Registered[] = [],
  refused: readonly { line: number; column: number }[] = [],
): ReadonlyMap<string, Override> {
  return overridden(
    generatedRules(mergeDesign(DEFAULTS, design), setting, registered),
    ownDeclarations(css),
    refused,
  );
}

function pagePrelude(selector: string): string | undefined {
  const keyword = /^\s*@page\b/i.exec(selector);
  return keyword === null ? undefined : normalized(selector.slice(keyword[0].length));
}

/** A selector list split on its top-level commas, each item normalized. */
function selectorList(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  const text = withoutComments(list);
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quote !== undefined) {
      if (char === "\\") at++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      items.push(text.slice(start, at));
      start = at + 1;
    }
  }
  items.push(text.slice(start));
  return items.map(normalized).filter((item) => item !== "");
}

/**
 * Collapses whitespace, drops it around combinators and commas, and
 * lowercases tag names, so two spellings of one selector compare equal.
 */
function normalized(selector: string): string {
  return withoutComments(selector)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*([>+~,])\s*/g, "$1")
    .replace(/(^|[\s>+~(,])([A-Za-z][\w-]*)/g, (_, lead: string, tag: string) => lead + tag.toLowerCase());
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function nameOf(css: string, name: SyntaxNode): string {
  const text = css.slice(name.from, name.to);
  return name.name === "VariableName" ? text : text.toLowerCase();
}

function lineStarts(css: string): number[] {
  const starts = [0];
  for (let at = css.indexOf("\n"); at !== -1; at = css.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/** Lines and columns count from 1, and a column counts UTF-16 code units. */
function placeOf(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
}

function before(a: Place, b: Place): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}
