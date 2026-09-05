/**
 * A book's reading order as one flat list: a section's heading, then
 * the entries under it.
 *
 * A row and a whole section are one kind of thing to drag, and a drop
 * lands where the gap opened. A section drags with its entries hidden,
 * and they move with it.
 */

import type { Place } from "@/book/order";
import type { Grouped, Row } from "@/ui/shelf";

/** One line of the list: a section's heading, or an entry. */
export type Item =
  | { id: string; kind: "group"; heading: string; rows: number }
  | { id: string; kind: "row"; heading: string; row: Row };

/** The result of dropping an entry: the reordered list and the entry's new place. */
export interface Moved {
  items: Item[];
  /** The entry's place in the reading order, which the edit names it by. */
  from: number;
  to: Place;
}

/** The result of dropping a section: the reordered list and the section's new index. */
export interface Sectioned {
  items: Item[];
  at: number;
}

const ENTRY = "e:";
const GROUP = "g:";

/** The id a section is dragged by. */
export function groupId(heading: string): string {
  return `${GROUP}${heading}`;
}

/** The id an entry is dragged by, which is its place in the reading order. */
export function rowId(at: number): string {
  return `${ENTRY}${at}`;
}

/** Whether an id names a section rather than an entry. */
export function isGroup(id: string): boolean {
  return id.startsWith(GROUP);
}

/** The section an id names. */
export function headingOf(id: string): string {
  return id.slice(GROUP.length);
}

/** The groups as one list, every row's place counted from the top. */
export function flatten(groups: Grouped[]): Item[] {
  return settle(
    groups.flatMap((group) => [
      ...(group.heading === ""
        ? []
        : [
            {
              id: groupId(group.heading),
              kind: "group" as const,
              heading: group.heading,
              rows: 0,
            },
          ]),
      ...group.rows.map((row) => ({
        id: rowId(row.at),
        kind: "row" as const,
        heading: group.heading,
        row,
      })),
    ]),
  );
}

/**
 * The list with one section's entries hidden. They move with its
 * heading, so a section drags as one row of the list.
 */
export function collapse(items: Item[], heading: string): Item[] {
  return items.filter(
    (item) => item.kind === "group" || item.heading !== heading,
  );
}

/** Computes each item's place: the section above it and its index in that section. */
export function places(items: Item[]): Place[] {
  const found: Place[] = [];
  let heading = "";
  let at = 0;
  for (const item of items) {
    if (item.kind === "group") {
      heading = item.heading;
      at = 0;
      found.push({ heading, at });
      continue;
    }
    found.push({ heading, at });
    at += 1;
  }
  return found;
}

/** One entry dropped on another item, or nothing when it did not move. */
export function moveRow(
  items: Item[],
  id: string,
  onto: string,
): Moved | undefined {
  const from = items.findIndex((item) => item.id === id);
  const to = items.findIndex((item) => item.id === onto);
  const held = items[from];
  if (held === undefined || held.kind !== "row" || to < 0 || from === to) {
    return undefined;
  }

  const next = [...items];
  next.splice(from, 1);
  next.splice(to, 0, held);

  const was = places(items)[from];
  const now = places(next)[to];
  if (was === undefined || now === undefined) return undefined;
  if (was.heading === now.heading && was.at === now.at) return undefined;

  // A place is an index into the group as the note has it now, so a
  // move down inside one group counts the row it is leaving.
  const at =
    was.heading === now.heading && now.at > was.at ? now.at + 1 : now.at;
  return {
    items: settle(next),
    from: held.row.at,
    to: { heading: now.heading, at },
  };
}

/** One section dropped on another item, or nothing when it did not move. */
export function moveSection(
  items: Item[],
  heading: string,
  onto: string,
): Sectioned | undefined {
  const from = items.findIndex(
    (item) => item.kind === "group" && item.heading === heading,
  );
  const held = items[from];
  const over = items.findIndex((item) => item.id === onto);
  if (held === undefined || held.kind !== "group" || over < 0) return undefined;

  const block = items.slice(from, from + held.rows + 1);
  const rest = [...items.slice(0, from), ...items.slice(from + held.rows + 1)];
  const landing = rest.findIndex((item) => item.id === onto);
  if (landing < 0) return undefined;

  // A section lands where another section starts, or at the end of the
  // list. Nothing lands above the entries the note opens with, because
  // a heading written above those entries would take them.
  const cut = nearest(stops(rest), over > from ? landing + 1 : landing);
  const lead = rest[0]?.kind === "row" ? 1 : 0;
  const at = lead + sections(rest.slice(0, cut));
  if (at === lead + sections(items.slice(0, from))) return undefined;

  return {
    items: settle([...rest.slice(0, cut), ...block, ...rest.slice(cut)]),
    at,
  };
}

/**
 * The list with every row's place counted again, and every item under
 * the section it is now in. A row names its entry by that place and
 * every edit names it the same way, so a list a drop leaves up counts
 * the way the note will.
 */
export function settle(items: Item[]): Item[] {
  const next: Item[] = [];
  let group: Extract<Item, { kind: "group" }> | undefined;
  let heading = "";
  let at = 0;
  for (const item of items) {
    if (item.kind === "group") {
      heading = item.heading;
      group = { id: groupId(heading), kind: "group", heading, rows: 0 };
      next.push(group);
      continue;
    }
    const row = { ...item.row, at };
    next.push({ id: rowId(at), kind: "row", heading, row });
    if (group !== undefined) group.rows += 1;
    at += 1;
  }
  return next;
}

/** The indexes a section may start at: another section's heading, or the end. */
function stops(items: Item[]): number[] {
  const found = items.flatMap((item, at) =>
    item.kind === "group" ? [at] : [],
  );
  found.push(items.length);
  return found;
}

function nearest(stops: number[], at: number): number {
  let best = at;
  let gap = Number.POSITIVE_INFINITY;
  for (const stop of stops) {
    if (Math.abs(stop - at) < gap) {
      gap = Math.abs(stop - at);
      best = stop;
    }
  }
  return best;
}

function sections(items: Item[]): number {
  return items.filter((item) => item.kind === "group").length;
}
