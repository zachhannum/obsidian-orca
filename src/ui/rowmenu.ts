/**
 * The menu a navigator row opens, as far as the device settles it: the
 * items an entry offers, the title a sheet opens under, and the place a
 * menu is put.
 */

import { DEEPEST_LEVEL } from "@/book/note";
import type { Device } from "@/ui/device";

/** One item on an entry's menu. */
export type EntryItem =
  | "markdown"
  | "preview"
  | "chapter"
  | "role"
  | "locate"
  | "reveal"
  | "remove";

/** The part of a row its menu reads. */
export interface Offering {
  kind: "note" | "generated" | "missing";
  path?: string | undefined;
}

/**
 * Lists an entry's items, a separator between each group. A finger has
 * no Mod click, so mobile opens the note and the preview from the menu.
 */
export function entryItems(device: Device, row: Offering): EntryItem[][] {
  const opens: EntryItem[] = [];
  if (device !== "desktop") {
    if (row.kind === "note" && row.path !== undefined) opens.push("markdown");
    if (row.kind !== "missing") opens.push("preview");
  }
  const edits: EntryItem[] = ["chapter", "role"];
  if (row.kind === "missing") edits.push("locate");
  else if (row.path !== undefined) edits.push("reveal");
  return [opens, edits, ["remove" as const]].filter((group) => group.length > 0);
}

/** One choice on a book's headings menu. */
export interface HeadingItem {
  title: string;
  /** The level the book note is given. No level takes the key out of it. */
  value: number | undefined;
  checked: boolean;
}

/**
 * Lists the choices on a book's headings menu. `own` is the level the
 * book note holds, and `fallback` is the level the settings list, which
 * the first choice names.
 */
export function headingItems(
  own: number | undefined,
  fallback: number | undefined,
): HeadingItem[] {
  const followed = fallback === undefined ? "hidden" : `level ${String(fallback)}`;
  const levels = Array.from({ length: DEEPEST_LEVEL }, (_, at) => at + 1);
  return [
    { title: `Use the default (${followed})`, value: undefined, checked: own === undefined },
    { title: "Hidden", value: 0, checked: own === 0 },
    ...levels.map((level) => ({
      title: `Down to level ${String(level)}`,
      value: level,
      checked: own === level,
    })),
  ];
}

/** The title over a row's menu. Only a phone's sheet has one. */
export function menuTitle(device: Device, name: string): string | undefined {
  return device === "phone" ? name : undefined;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Places a row's menu. A tablet opens it beside the row, at the row's
 * end, wherever on the row the finger was. A phone's sheet ignores the
 * place.
 */
export function menuPlace(
  device: Device,
  row: { top: number; right: number },
  pointer: Point,
): Point {
  return device === "tablet" ? { x: row.right, y: row.top } : pointer;
}
