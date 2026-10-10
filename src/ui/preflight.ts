/**
 * The checks export runs before it writes. Orca blocks on the facts it
 * records itself: a section with no note, a use of a font that
 * registered no face, and an embed that brought no bytes. A case only the engine can see is not
 * checked here. The engine's warnings are listed under the errors as
 * the engine wrote them, and none of them blocks.
 */

import type { Warning } from "fleuron";
import { entryName, type Section } from "@/book/order";
import type { Unread } from "@/book/plan";
import { LEVELS, headingUse, useKey, type Design, type FontUse } from "@/style/design";
import { readOrigin, type Place } from "@/style/origin";
import type { Unloaded } from "@/ui/composer";
import { groupTitle, routeOf, tally } from "@/ui/issues";

/** One error that keeps export from writing. */
export interface Blocker {
  kind: "note" | "face" | "image";
  /** The line the author reads first. */
  said: string;
  /**
   * The place the error is at: the heading the section sits under, where
   * the font is used, or the note and line.
   */
  place: string;
  /** The label of the button that goes to the fix. */
  fix: string;
  /** The engine's own warning at the same place, as the engine wrote it. */
  engine: string | undefined;
  /** The note an image error is in, with its line counted from 0. */
  at: { note: string; line: number } | undefined;
  /** The place in the reading order of a section with no note. */
  row: number | undefined;
}

/** One warning from the engine. It does not keep export from writing. */
export interface Caution {
  /** The engine's message, unchanged. */
  said: string;
  /** The note or sheet and the line. None for a warning that names no place. */
  place: string | undefined;
  /** The label of the button that goes to the warning. */
  fix: string;
  /** The place the button opens. Without one it opens Issues. */
  at: { route: "note" | "css"; place: Place } | undefined;
}

/** The book as preflight reads it. */
export interface Checking {
  design: Design;
  /** The book's sections in reading order, with the ones that have no note. */
  sections: readonly Section[];
  unloaded: readonly Unloaded[];
  unread: readonly Unread[];
  warnings: readonly Warning[];
}

export interface Checked {
  errors: Blocker[];
  /** The engine's warnings an error does not already show. */
  warnings: Caution[];
  /**
   * `No errors` when the book passes, with the count of its warnings
   * after it, and nothing when it does not.
   */
  fine: string | undefined;
}

export function preflight(book: Checking): Checked {
  const notes = book.sections.flatMap((section, row): Blocker[] => {
    if (section.kind !== "missing") return [];
    const { heading } = section.entry;
    return [
      {
        kind: "note",
        said: `Missing note: ${entryName(section.entry)}`,
        place: heading === "" ? "Book" : heading,
        fix: "Show in navigator",
        engine: undefined,
        at: undefined,
        row,
      },
    ];
  });
  const faces = book.unloaded.map((each): Blocker => {
    const name = faceName(each.use);
    return {
      kind: "face",
      said: each.unread ? `Cannot read font file: ${name}` : `Missing font: ${name}`,
      place: usedIn(book.design, each.use),
      fix: "Change font…",
      engine: undefined,
      at: undefined,
      row: undefined,
    };
  });
  const shown = new Set<Warning>();
  const images = book.unread.map((each): Blocker => {
    const engine = warningAt(book.warnings, each.note, each.line + 1);
    if (engine !== undefined) shown.add(engine);
    return {
      kind: "image",
      said: `Missing image: ${each.url}`,
      place: `${noteTitle(each.note)}, line ${String(each.line + 1)}`,
      fix: "Go to line",
      engine: engine?.message,
      at: { note: each.note, line: each.line },
      row: undefined,
    };
  });

  const errors = [...notes, ...faces, ...images];
  const warnings = book.warnings.flatMap((warning): Caution[] => {
    const route = routeOf(warning);
    // A warning against orca's own sheets is not the author's to fix.
    if (route === "orca" || shown.has(warning)) return [];
    const place = warning.origin === null ? undefined : readOrigin(warning.origin);
    if (place === undefined) {
      return [{ said: warning.message, place: undefined, fix: "Open Issues", at: undefined }];
    }
    const source = groupTitle({ route, source: place.sheet, issues: [] });
    return [
      {
        said: warning.message,
        place: `${source}, line ${String(place.line)}`,
        fix: "Go to line",
        at: { route, place },
      },
    ];
  });
  return { errors, warnings, fine: errors.length === 0 ? passed(warnings.length) : undefined };
}

/** The line a book with no errors reads, as `No errors · 2 warnings`. */
function passed(warnings: number): string {
  return warnings === 0 ? "No errors" : `No errors · ${tally(0, warnings)}`;
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
    places.push("headers");
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
  return groupTitle({ route: "note", source: note, issues: [] });
}

/** The first engine warning at a note's line, counted from 1. */
function warningAt(warnings: readonly Warning[], note: string, line: number): Warning | undefined {
  return warnings.find((warning) => {
    if (warning.origin === null) return false;
    const place = readOrigin(warning.origin);
    return place?.sheet === note && place.line === line;
  });
}
