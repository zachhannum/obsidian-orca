/**
 * The marks orca draws over a note: fleuron's attribute runs and its
 * setext headings.
 *
 * A mark is a rule about a block, so the note is parsed and the rules
 * are matched against blocks rather than scanned out of lines. The
 * engine still settles the page. A mark is what the editor draws, so
 * a mark orca gets wrong is wrong in the editor and not in the book.
 */

import type { SyntaxNode } from "@lezer/common";
import { notes } from "@/book/dialect";

/** The marks the editor draws. */
export type Form = "line" | "heading" | "image" | "span" | "setext";

/** The names a run gives the block it is written on. */
export interface Names {
  /** The one id, without its `#`. */
  id: string | undefined;
  /** Each class, without its `.`, in written order. */
  classes: string[];
  /**
   * The run's own text, without its braces. The chip draws this
   * instead of the names when the run yields neither an id nor a
   * class, which is a run fleuron reads and cannot use.
   */
  said: string;
}

/** A mark, as characters of the note. */
export interface Drawn {
  form: Form;
  /** The mark's own text: the run, or a setext heading's underline. */
  from: number;
  to: number;
  /** The names the chip draws, on every form but a setext heading. */
  names: Names | undefined;
  /** The heading's level, on a setext heading alone. */
  level: 1 | 2 | undefined;
  /**
   * The character the mark's own block opens at: the `[` a span run
   * closes, and the first text line of a setext heading.
   */
  open: number | undefined;
}

/** The blocks nothing inside is read as prose. */
const OPAQUE = new Set(["Frontmatter", "FencedCode", "CodeBlock", "HTMLBlock", "Comment"]);

/** The blocks a run can be written on. */
const PROSE = new Set(["Paragraph", "TableCell"]);

/** The heading levels an ATX heading is read at. */
const ATX = new Set([
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
]);

/**
 * Every mark of one note, in written order.
 *
 * The note is parsed whole. A caller that wants the marks of one
 * section takes the ones its characters cover.
 */
export function marksIn(text: string): Drawn[] {
  const found: Drawn[] = [];
  const tree = notes.parse(text);
  tree.iterate({
    enter(node) {
      if (OPAQUE.has(node.name)) return false;
      if (node.name === "SetextHeading1" || node.name === "SetextHeading2") {
        onSetext(text, node.node, node.name === "SetextHeading1" ? 1 : 2, found);
        return false;
      }
      if (ATX.has(node.name)) {
        onHeading(text, node.node, found);
        return false;
      }
      if (PROSE.has(node.name)) {
        onProse(text, node.node, found);
        return false;
      }
      return true;
    },
  });
  found.sort((one, two) => one.from - two.from);
  return found;
}

/**
 * A paragraph or a table cell, which is where every form but a
 * heading's own run is written.
 */
function onProse(text: string, node: SyntaxNode, found: Drawn[]): void {
  const said = text.slice(node.from, node.to);
  const run = onlyRun(said);
  if (run !== undefined) {
    // An attribute line is a paragraph whose whole content is one
    // brace run, which is what makes it a line and not a tail of
    // prose. A table cell of one run is prose, because the cell is
    // not a block the run can name.
    const names = reads(run.inside);
    // A line names the block under it, inside whatever holds them
    // both. A run with nothing under it there names nothing, and
    // fleuron leaves it as the prose it was written as.
    const under = node.nextSibling !== null;
    if (node.name === "Paragraph" && names !== undefined && under) {
      found.push(line(node.from + run.from, node.from + run.to, names));
      return;
    }
  }
  const image = imaged(text, node);
  const named = image === undefined ? undefined : reads(image.inside);
  if (image !== undefined && named !== undefined) {
    found.push({
      form: "image",
      from: image.from,
      to: image.to,
      names: named,
      level: undefined,
      open: undefined,
    });
    return;
  }
  found.push(...spansIn(text, node));
}

/** The run an image alone on its line takes, which names that image. */
function imaged(
  text: string,
  node: SyntaxNode,
): { from: number; to: number; inside: string } | undefined {
  const first = node.firstChild;
  if (first === null || first.name !== "Image" || first.from !== node.from) return undefined;
  const after = text.slice(first.to, node.to);
  const run = onlyRun(after);
  if (run === undefined) return undefined;
  // The run has to be written on the image's own line. A run on the
  // line below is a block of its own, and fleuron reads it as one.
  if (after.slice(0, run.from).includes("\n")) return undefined;
  // The run's chip sits where the run was written, and the blanks
  // between the image and the brace come off with it.
  return { from: first.to, to: first.to + run.to, inside: run.inside };
}

/** A heading's own trailing run, which fleuron reads as the heading's attributes. */
function onHeading(text: string, node: SyntaxNode, found: Drawn[]): void {
  const run = trailing(text.slice(node.from, node.to));
  if (run !== undefined) {
    found.push({
      form: "heading",
      from: node.from + run.from,
      to: node.from + run.to,
      names: namesOf(run.inside),
      level: undefined,
      open: undefined,
    });
  }
  found.push(...spansIn(text, node));
}

/**
 * A setext heading, and the one shape that is not one.
 *
 * A brace run over a row of dashes is an attribute line over a scene
 * break, so the run names the break and there is no heading.
 */
function onSetext(text: string, node: SyntaxNode, level: 1 | 2, found: Drawn[]): void {
  const said = text.slice(node.from, node.to);
  const broke = said.lastIndexOf("\n");
  if (broke < 0) return;
  const above = said.slice(0, broke);
  const run = above.length === 0 ? undefined : onlyRun(above);
  const names = run === undefined ? undefined : reads(run.inside);
  if (run !== undefined && names !== undefined && level === 2) {
    found.push(line(node.from + run.from, node.from + run.to, names));
    return;
  }
  found.push({
    form: "setext",
    from: node.from + broke + 1,
    to: node.to,
    names: undefined,
    level,
    open: node.from,
  });
  found.push(...spansIn(text, node));
}

/** The `[text]{.class}` runs written inside one block. */
function spansIn(text: string, node: SyntaxNode): Drawn[] {
  const found: Drawn[] = [];
  const said = text.slice(node.from, node.to);
  for (const match of said.matchAll(/\[([^\][\n]*)\]\{([^}\n]*)\}/g)) {
    const at = node.from + match.index;
    if (covered(node, at)) continue;
    const names = reads(match[2] ?? "");
    if (names === undefined) continue;
    const opened = at + (match[1]?.length ?? 0) + 2;
    found.push({
      form: "span",
      from: opened,
      to: at + match[0].length,
      names,
      level: undefined,
      open: at,
    });
  }
  return found;
}

/**
 * Whether a character of a block is inside code or an image rather
 * than prose.
 *
 * A bracket with no destination is a link node here and is text to
 * fleuron, so it is not covered. A bracket that does have one is
 * closed by `(` or `[` rather than by a brace, so the run never
 * matches it.
 */
function covered(node: SyntaxNode, at: number): boolean {
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.from > at) return false;
    if (child.to <= at) continue;
    return child.name === "InlineCode" || child.name === "Image";
  }
  return false;
}

/** An attribute line's mark, which the chip draws in place of. */
function line(from: number, to: number, names: Names): Drawn {
  return { form: "line", from, to, names, level: undefined, open: undefined };
}

/** A block whose whole content is one brace run, as the characters of that run. */
function onlyRun(said: string): { from: number; to: number; inside: string } | undefined {
  const from = said.length - said.trimStart().length;
  const to = said.trimEnd().length;
  const only = said.slice(from, to);
  if (only.length < 2 || !only.startsWith("{") || !only.endsWith("}")) return undefined;
  if (only.includes("\n") || only.slice(1, -1).includes("}")) return undefined;
  return { from, to, inside: only.slice(1, -1) };
}

/** The `{...}` a block ends on, with the blanks before it. */
function trailing(said: string): { from: number; to: number; inside: string } | undefined {
  const to = said.trimEnd().length;
  const only = said.slice(0, to);
  if (!only.endsWith("}")) return undefined;
  const open = only.lastIndexOf("{");
  if (open <= 0 || only.slice(open).includes("\n")) return undefined;
  let from = open;
  while (from > 0 && /\s/.test(only[from - 1] ?? "")) from -= 1;
  if (from === 0) return undefined;
  return { from, to, inside: only.slice(open + 1, -1) };
}

/**
 * The names a run gives, or nothing for a run fleuron rejects.
 *
 * A rejected run is prose everywhere but on a heading, where the
 * heading is still a heading and the run is drawn as it was written.
 */
function reads(inside: string): Names | undefined {
  const said = inside.trim();
  const classes: string[] = [];
  let id: string | undefined;
  for (const word of said.split(/\s+/).filter((word) => word !== "")) {
    const name = identifier(word.slice(1));
    if (name === undefined) return undefined;
    if (word.startsWith(".")) classes.push(name);
    else if (word.startsWith("#") && id === undefined) id = name;
    else return undefined;
  }
  return { id, classes, said };
}

/**
 * A name a selector can reach a block back by: letters, digits, `-`
 * and `_`, not opening with a digit.
 */
function identifier(word: string): string | undefined {
  const opens = word[0];
  if (opens === undefined || (opens >= "0" && opens <= "9")) return undefined;
  return /^[\p{L}\p{N}_-]+$/u.test(word) ? word : undefined;
}

/**
 * The names a run gives a heading. A run fleuron reads and cannot use
 * is drawn as it was written.
 */
export function namesOf(inside: string): Names {
  return reads(inside) ?? { id: undefined, classes: [], said: inside.trim() };
}
