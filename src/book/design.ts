/**
 * A design note: a note whose frontmatter is a design and whose body is
 * not a reading order.
 *
 * Books that share a design point at one of these. The design panel
 * renders it the way it renders a book's own frontmatter.
 */

import { writeFrontmatter, type Properties } from "@/book/frontmatter";
import { DESIGN_KEYS, readDesign, writeDesign, type Design } from "@/style/design";

/** Frontmatter key that makes a note a design. Its value is the format. */
export const DESIGN_KEY = "orca-design";

/** The format orca writes. A note above it does not open. */
export const DESIGN_FORMAT = 1;

/** A design note, read whole. */
export interface DesignNote {
  format: number;
  design: Design;
  /** The author's own properties, which orca keeps and does not read. */
  own: Properties;
}

/** The format a design note is written in, or nothing when the note is not one. */
export function designFormat(properties: Properties): number | undefined {
  const value = properties[DESIGN_KEY];
  if (value === undefined || value === null) return undefined;
  const format = Number(value);
  return Number.isFinite(format) ? format : undefined;
}

/** The design in a note. A note that is not a design note reads as one that sets nothing. */
export function readDesignNote(properties: Properties): DesignNote {
  const own: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === DESIGN_KEY || DESIGN_KEYS.includes(key)) continue;
    own[key] = value;
  }
  return {
    format: designFormat(properties) ?? DESIGN_FORMAT,
    design: readDesign(properties),
    own,
  };
}

/** The properties a design note is written back as, at `DESIGN_FORMAT`. */
export function writeDesignNote(note: DesignNote): Properties {
  return {
    [DESIGN_KEY]: DESIGN_FORMAT,
    ...writeDesign(note.design),
    ...note.own,
  };
}

/**
 * The design note, written into properties a note already has. Orca's
 * own keys are set and the ones the design no longer has are removed.
 */
export function applyDesignNote(properties: Properties, design: Design): void {
  properties[DESIGN_KEY] = DESIGN_FORMAT;
  const written = writeDesign(design);
  for (const key of DESIGN_KEYS) {
    const value = written[key];
    if (value === undefined) delete properties[key];
    else properties[key] = value;
  }
}

/** A design note as text, which is how a new one is created. */
export function designNoteText(design: Design, body = "\n"): string {
  return writeFrontmatter({
    properties: writeDesignNote({ format: DESIGN_FORMAT, design, own: {} }),
    body,
  });
}
