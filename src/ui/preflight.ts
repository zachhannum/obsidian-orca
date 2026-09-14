/**
 * The checks export runs before it writes. Orca blocks on the facts it
 * records itself: a use of a font that registered no face, and an
 * embed that brought no bytes. A case only the engine can see is not
 * checked here.
 */

import type { Warning } from "fleuron";
import type { Unread } from "@/book/plan";
import { LEVELS, designUses, headingUse, useKey, type Design, type FontUse } from "@/style/design";
import { readOrigin } from "@/style/origin";
import type { Unloaded } from "@/ui/composer";

/** One error that keeps export from writing. */
export interface Blocker {
  kind: "face" | "image";
  /** The line the author reads first. */
  said: string;
  /** The place the error is at: what the face was chosen for, or the note and line. */
  place: string;
  /** A fix, in a few words. */
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
  /** The number of image urls that resolved. */
  images: number;
  warnings: readonly Warning[];
}

export interface Checked {
  errors: Blocker[];
  /** The line that says the rest is fine, or nothing when nothing else is. */
  fine: string | undefined;
}

const NUMBERS = [
  "no", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];

/** A count as a word up to twelve, and in digits above. */
function counted(count: number): string {
  return NUMBERS[count] ?? count.toLocaleString("en");
}

export function preflight(book: Checking): Checked {
  const faces = book.unloaded.map((each): Blocker => {
    const name = faceName(each.use);
    return {
      kind: "face",
      said: each.unread
        ? `${name} has files that would not read, so the PDF could not embed it.`
        : `${name} has no file the PDF could embed.`,
      place: `chosen for ${chosenFor(book.design, each.use)}`,
      fix: "pick another face",
      engine: undefined,
      at: undefined,
    };
  });
  const images = book.unread.map((each): Blocker => ({
    kind: "image",
    said: `The vault has no ${each.url}.`,
    place: `embedded in ${noteTitle(each.note)}, line ${String(each.line + 1)}`,
    fix: "locate it",
    engine: warningAt(book.warnings, each.note, each.line + 1),
    at: { note: each.note, line: each.line },
  }));

  const uses = designUses(book.design).length;
  const said: string[] = [];
  if (faces.length === 0) said.push("Every face embeds.");
  else if (uses > faces.length) said.push("Every other face embeds.");
  if (images.length === 0) said.push("Every image resolves.");
  else if (book.images === 1) said.push("The other image resolves.");
  else if (book.images > 1) said.push(`The other ${counted(book.images)} images resolve.`);

  return {
    errors: [...faces, ...images],
    fine: said.length === 0 ? undefined : said.join(" "),
  };
}

/** The footer line while errors stand. */
export function standing(errors: number): string {
  const count = counted(errors);
  const capital = count.charAt(0).toUpperCase() + count.slice(1);
  return errors === 1
    ? `${capital} error stands. Export will not write while it does.`
    : `${capital} errors stand. Export will not write while they do.`;
}

function faceName(use: FontUse): string {
  return use.variant === undefined ? use.font : `${use.font} ${use.variant}`;
}

/** The places a design sets a use, as `the body text and level 1 and 2 headings`. */
function chosenFor(design: Design, use: FontUse): string {
  const key = useKey(use);
  const { font, fontVariant } = design.body;
  const body = font === undefined ? undefined : { font, variant: fontVariant };
  const places: string[] = [];
  if (body !== undefined && useKey(body) === key) places.push("the body text");
  const levels = LEVELS.filter((level) => {
    const heading = headingUse(design.headings[level], body);
    return heading !== undefined && useKey(heading) === key;
  }).map(String);
  if (levels.length > 0) places.push(`level ${listed(levels)} headings`);
  return places.length === 0 ? "the book" : places.join(" and ");
}

function listed(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
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
