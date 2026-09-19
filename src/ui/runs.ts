/**
 * The marks fleuron reads and Obsidian draws as prose: an attribute
 * run, and a setext heading of more than one line.
 *
 * Where a run is comes from the engine's parse of the note. orca
 * proposes a place by its shape and the engine settles whether a node
 * was read there, so nothing here parses markdown. A run the engine
 * did not read stays the text the author typed.
 */

import type { NodeSource } from "fleuron";
import { offsetOf } from "@/book/place";

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
   * class, which is a run the engine read and cannot use.
   */
  said: string;
}

/**
 * A place orca asks the engine about, and the mark it would be. The
 * ask is made at {@link Candidate.byte}, and the answer's span is
 * what settles it.
 */
export interface Candidate {
  form: Form;
  /** The byte of the note the ask is made at. */
  byte: number;
  /** The mark's own text, as bytes of the note. */
  from: number;
  to: number;
  /** The level an underline gives, on a setext heading alone. */
  level: 1 | 2 | undefined;
  /** The bracketed text a span run closes, on a span alone. */
  open: number | undefined;
  /** The run's own text, without its braces. Empty on a setext heading. */
  inside: string;
}

/** A mark the engine settled, as bytes of the note. */
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
   * The byte the mark's own block opens at: the `[` a span run
   * closes, and the first text line of a setext heading.
   */
  open: number | undefined;
}

/** A line of a note: its text, and the byte the line opens at. */
interface Line {
  from: number;
  to: number;
  text: string;
}

/** The byte of the note a character of one line falls at. */
function byteIn(line: Line, at: number): number {
  return line.from + new TextEncoder().encode(line.text.slice(0, at)).length;
}

/**
 * Every place in a note that has the shape of a mark. The engine is
 * asked about each one, because a shape is not a parse: `{#one #two}`
 * on its own line has the shape of an attribute line and is prose.
 */
export function candidates(text: string): Candidate[] {
  const found: Candidate[] = [];
  for (const line of linesOf(text)) {
    found.push(...spansOn(line), ...onLine(line));
  }
  return found;
}

/** The candidates a whole line makes: an attribute line, an underline, an image run, a heading run. */
function onLine(line: Line): Candidate[] {
  const said = line.text.trim();
  if (said.startsWith("{") && said.endsWith("}")) {
    return [
      {
        form: "line",
        byte: line.from,
        from: line.from,
        to: line.to,
        level: undefined,
        open: undefined,
        inside: said.slice(1, -1),
      },
    ];
  }
  const level = underline(said);
  if (level !== undefined) {
    return [
      { form: "setext", byte: line.from, from: line.from, to: line.to, level, open: undefined, inside: "" },
    ];
  }
  const run = trailingRun(line);
  if (run === undefined) return [];
  // An image alone on its line is a block of its own, so the ask is
  // made where the line opens; a heading's run is asked about where it
  // opens, because the heading covers the whole line either way.
  const image = said.startsWith("![");
  if (image) {
    return [{ ...run, form: "image", byte: line.from, level: undefined, open: undefined }];
  }
  if (!said.startsWith("#")) return [];
  return [{ ...run, form: "heading", byte: run.from, level: undefined, open: undefined }];
}

/** The bracketed runs written inside a line: `[text]{.class}`. */
function spansOn(line: Line): Candidate[] {
  const found: Candidate[] = [];
  for (const match of line.text.matchAll(/\[/g)) {
    const open = line.from + match.index;
    const closed = closes(line, match.index);
    if (closed === undefined) continue;
    found.push({ ...closed, form: "span", byte: open, level: undefined, open });
  }
  return found;
}

/** The `{...}` written directly after the `]` that closes the text opened at `at`. */
function closes(line: Line, at: number): Run | undefined {
  const shut = line.text.indexOf("]{", at);
  if (shut < 0) return undefined;
  const end = line.text.indexOf("}", shut + 2);
  if (end < 0) return undefined;
  return {
    from: byteIn(line, shut + 1),
    to: byteIn(line, end + 1),
    inside: line.text.slice(shut + 2, end),
  };
}

/** A run's bytes and its own text. */
interface Run {
  from: number;
  to: number;
  inside: string;
}

/** The `{...}` a line ends on, with the blanks before it, or nothing where a line ends on no run. */
function trailingRun(line: Line): Run | undefined {
  const said = line.text.trimEnd();
  if (!said.endsWith("}")) return undefined;
  const open = said.lastIndexOf("{");
  if (open <= 0) return undefined;
  let from = open;
  while (from > 0 && /\s/.test(said[from - 1] ?? "")) from -= 1;
  return { from: byteIn(line, from), to: byteIn(line, said.length), inside: said.slice(open + 1, -1) };
}

/** The heading level a row of `=` or `-` gives, or nothing for a row that is neither. */
function underline(said: string): 1 | 2 | undefined {
  if (said.length === 0) return undefined;
  if (/^=+$/.test(said)) return 1;
  // Fewer than three dashes underline a heading; three or more under
  // an attribute line are a scene break, which the engine settles.
  if (/^-+$/.test(said)) return 2;
  return undefined;
}

/**
 * The marks the engine settled, one answer per candidate in the order
 * they were asked about. A candidate the engine read no node at, or
 * read a node whose span does not cover the mark, is prose.
 */
export function drawn(
  text: string,
  asked: readonly Candidate[],
  answers: readonly (NodeSource | undefined)[],
): Drawn[] {
  const found: Drawn[] = [];
  for (const [at, candidate] of asked.entries()) {
    const span = answers[at];
    if (span === undefined) continue;
    const mark = settled(text, candidate, span);
    if (mark !== undefined) found.push(mark);
  }
  return found;
}

/** One candidate, against the span the engine read at it. */
function settled(text: string, candidate: Candidate, span: NodeSource): Drawn | undefined {
  const { form, from, to } = candidate;
  const names = (): Names => namesOf(candidate.inside);
  switch (form) {
    // The node the line opens is the block under it, so its span
    // begins at the line and runs past it. A run the engine could not
    // read is a paragraph of its own, and its span is the line alone.
    case "line":
      return span.start === from && span.end > to
        ? { form, from, to, names: names(), level: undefined, open: undefined }
        : undefined;
    // A setext heading's span holds its text lines and its underline.
    case "setext": {
      if (span.start >= from || span.end < to) return undefined;
      const opens = headingAt(text, span.start, from);
      return opens === undefined
        ? undefined
        : { form, from, to, names: undefined, level: candidate.level, open: opens };
    }
    // An image's span ends after its run, so a run the engine read is
    // inside it and a run it did not read is outside.
    case "image":
      return span.start <= from && span.end >= to
        ? { form, from, to, names: names(), level: undefined, open: undefined }
        : undefined;
    // A heading covers its whole line, so a run it read is the
    // heading's own bytes rather than a node written inside it.
    case "heading":
      return span.start <= candidate.byte && span.end >= to && span.start < from
        ? { form, from, to, names: names(), level: undefined, open: undefined }
        : undefined;
    // A span run's node is the bracketed text and the run together.
    case "span":
      return span.start === candidate.open && span.end === to
        ? { form, from, to, names: names(), level: undefined, open: candidate.open }
        : undefined;
  }
}

/**
 * The names a run gives. A run that yields neither an id nor a class
 * is one the engine read and cannot use, and it is drawn as it was
 * written.
 */
export function namesOf(inside: string): Names {
  const said = inside.trim();
  const classes: string[] = [];
  const ids: string[] = [];
  for (const word of said.split(/\s+/)) {
    if (word.length < 2) continue;
    if (word.startsWith(".")) classes.push(word.slice(1));
    else if (word.startsWith("#")) ids.push(word.slice(1));
  }
  const named = classes.length + ids.length;
  const read = named > 0 && named === said.split(/\s+/).filter((word) => word !== "").length;
  return read && ids.length <= 1
    ? { id: ids[0], classes, said }
    : { id: undefined, classes: [], said };
}

/**
 * The byte a setext heading's own text opens at, past an attribute
 * line naming it. Nothing where the text is that line alone: a row of
 * dashes under an attribute run is a scene break the run names, and
 * the engine reads it as one.
 */
function headingAt(text: string, from: number, under: number): number | undefined {
  const said = text.slice(offsetOf(text, from), offsetOf(text, under));
  const [first = ""] = said.split("\n");
  const named = first.trim().startsWith("{") && first.trim().endsWith("}");
  if (!named) return said.trim() === "" ? undefined : from;
  const rest = said.slice(first.length + 1);
  return rest.trim() === ""
    ? undefined
    : from + new TextEncoder().encode(first + "\n").length;
}

/** Every line of a note, as bytes of it. */
function linesOf(text: string): Line[] {
  const found: Line[] = [];
  const encoder = new TextEncoder();
  let at = 0;
  for (const said of text.split("\n")) {
    const width = encoder.encode(said).length;
    found.push({ from: at, to: at + width, text: said });
    at += width + 1;
  }
  return found;
}
