/**
 * The checks export runs before it writes. Orca blocks on the facts it
 * records itself: a use of a font that registered no face, and an
 * embed that brought no bytes. A case only the engine can see is not
 * checked here.
 */

import type { Warning } from "fleuron";
import type { Unread } from "@/book/plan";
import { LEVELS, headingUse, useKey, type Design, type FontUse } from "@/style/design";
import { readOrigin } from "@/style/origin";
import type { Unloaded } from "@/ui/composer";

/** One error that keeps export from writing. */
export interface Blocker {
  kind: "face" | "image";
  /** The line the author reads first. */
  said: string;
  /** The place the error is at: where the font is used, or the note and line. */
  place: string;
  /** The label of the button that goes to the fix. */
  fix: string;
  /** The engine's own warning at the same place, as the engine wrote it. */
  engine: string | undefined;
  /** The note an image error is in, with its line counted from 0. */
  at: { note: string; line: number } | undefined;
}

/** The book as preflight reads it. */
export interface Checking {
  design: Design;
  unloaded: readonly Unloaded[];
  unread: readonly Unread[];
  warnings: readonly Warning[];
}

export interface Checked {
  errors: Blocker[];
  /** `No errors` when the book passes, and nothing when it does not. */
  fine: string | undefined;
}

export function preflight(book: Checking): Checked {
  const faces = book.unloaded.map((each): Blocker => {
    const name = faceName(each.use);
    return {
      kind: "face",
      said: each.unread ? `Cannot read font file: ${name}` : `Missing font: ${name}`,
      place: usedIn(book.design, each.use),
      fix: "Change font…",
      engine: undefined,
      at: undefined,
    };
  });
  const images = book.unread.map((each): Blocker => ({
    kind: "image",
    said: `Missing image: ${each.url}`,
    place: `${noteTitle(each.note)}, line ${String(each.line + 1)}`,
    fix: "Go to line",
    engine: warningAt(book.warnings, each.note, each.line + 1),
    at: { note: each.note, line: each.line },
  }));

  const errors = [...faces, ...images];
  return { errors, fine: errors.length === 0 ? "No errors" : undefined };
}

/** The footer line while errors stand. */
export function standing(errors: number): string {
  return `Fix ${String(errors)} ${errors === 1 ? "error" : "errors"} to export`;
}

function faceName(use: FontUse): string {
  return use.variant === undefined ? use.font : `${use.font} ${use.variant}`;
}

/** The places a design sets a use, as `Body text, headings 1–3, 5`. */
function usedIn(design: Design, use: FontUse): string {
  const key = useKey(use);
  const { font, fontVariant } = design.body;
  const body = font === undefined ? undefined : { font, variant: fontVariant };
  const places: string[] = [];
  if (body !== undefined && useKey(body) === key) places.push("body text");
  const levels: number[] = LEVELS.filter((level) => {
    const heading = headingUse(design.headings[level], body);
    return heading !== undefined && useKey(heading) === key;
  });
  if (levels.length === 1) places.push(`heading ${String(levels[0])}`);
  if (levels.length > 1) places.push(`headings ${runs(levels)}`);
  const { font: head, folioFont: folio } = design.headers;
  if (head !== undefined && useKey({ font: head, variant: undefined }) === key) {
    places.push("running heads");
  }
  if (folio !== undefined && useKey({ font: folio, variant: undefined }) === key) {
    places.push("page numbers");
  }
  const said = places.length === 0 ? "book" : places.join(", ");
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** Ascending numbers with each unbroken run joined, as `1–3, 5`. */
function runs(numbers: readonly number[]): string {
  const grouped: number[][] = [];
  for (const each of numbers) {
    const last = grouped.at(-1);
    if (last !== undefined && last.at(-1) === each - 1) last.push(each);
    else grouped.push([each]);
  }
  return grouped
    .map((run) => (run.length === 1 ? String(run[0]) : `${String(run[0])}–${String(run.at(-1))}`))
    .join(", ");
}

function noteTitle(note: string): string {
  const name = note.slice(note.lastIndexOf("/") + 1);
  return name.endsWith(".md") ? name.slice(0, -".md".length) : name;
}

/** The message of the first engine warning at a note's line, counted from 1. */
function warningAt(warnings: readonly Warning[], note: string, line: number): string | undefined {
  return warnings.find((warning) => {
    if (warning.origin === null) return false;
    const place = readOrigin(warning.origin);
    return place?.sheet === note && place.line === line;
  })?.message;
}
