/**
 * The body of a book note is the reading order: headings that group
 * the matter, and a list of wikilinks under them.
 *
 * A line orca does not read is kept as it was written, and an entry is
 * written back in the format's own shape, so a book note orca has
 * written round-trips byte for byte.
 */

import { type Links, target } from "@/book/links";
import {
  DEFAULT_ROLE,
  ROLES,
  headingRole,
  roleOf,
  type Role,
} from "@/book/roles";

/** One entry in the reading order. */
export interface Entry {
  /** The link as written in the note, or nothing for a generated section. */
  link?: string;
  /** The alias on the link, in place of the note's name. */
  alias?: string;
  /** The tag that overrides the heading's role. */
  tag?: Role;
  /** The role this section has: the entry's own tag, or its heading's. */
  role: Role;
  /** The heading it sits under, as written in the note. */
  heading: string;
}

/** One line of the body: a heading, an entry, or a line kept as it was written. */
export type Block =
  | { kind: "heading"; line: string; heading: string; role: Role }
  | { kind: "entry"; entry: Entry }
  | { kind: "other"; line: string };

/** The body of a book note, block by block. */
export interface Order {
  blocks: Block[];
}

/** Where an entry sits: the group it is under, and its place in it. */
export interface Place {
  heading: string;
  /** The index among that group's entries, as the order has them now. */
  at: number;
}

/** One heading and the entries under it, by their place in the reading order. */
export interface Group {
  heading: string;
  role: Role;
  entries: number[];
}

/**
 * One section of the book: its note, a section orca generates, or a
 * note the vault does not have.
 */
export type Section =
  | { kind: "note"; entry: Entry; path: string }
  | { kind: "generated"; entry: Entry }
  | { kind: "missing"; entry: Entry };

/** One section orca cannot set. Only `ui` turns one into something an author sees. */
export interface Warning {
  entry: Entry;
  said: string;
}

/** The book's sections, and the entries that have no note. */
export interface Resolution {
  sections: Section[];
  warnings: Warning[];
}

/** The heading an add writes when the note has no group of chapters. */
const BODY = "Body";

const HEADING = /^#{1,6}\s+(.*?)\s*$/;
const ITEM = /^\s*[-*+]\s+(?:\[\[([^\]]+)\]\])?\s*(?:`([^`]*)`)?\s*$/;

/** The reading order in a note's body. */
export function readOrder(body: string): Order {
  const blocks: Block[] = [];
  let heading = "";
  let role: Role = DEFAULT_ROLE;

  for (const line of body.split("\n")) {
    const head = HEADING.exec(line);
    if (head !== null) {
      heading = head[1] ?? "";
      role = headingRole(heading);
      blocks.push({ kind: "heading", line, heading, role });
      continue;
    }
    const entry = readEntry(line, heading, role);
    blocks.push(
      entry === undefined ? { kind: "other", line } : { kind: "entry", entry },
    );
  }
  return { blocks };
}

/** A reading order written back as a body. */
export function writeOrder(order: Order): string {
  return order.blocks
    .map((block) => (block.kind === "entry" ? writeEntry(block.entry) : block.line))
    .join("\n");
}

/** One entry as a line: the link, then the tag. */
export function writeEntry(entry: Entry): string {
  const parts: string[] = [];
  if (entry.link !== undefined) {
    const alias = entry.alias === undefined ? "" : `|${entry.alias}`;
    parts.push(`[[${entry.link}${alias}]]`);
  }
  if (entry.tag !== undefined) parts.push(`\`${entry.tag}\``);
  return `- ${parts.join(" ")}`;
}

/** Every entry, in the order the note lists them. */
export function entries(order: Order): Entry[] {
  return order.blocks.flatMap((block) =>
    block.kind === "entry" ? [block.entry] : [],
  );
}

/** What a surface calls an entry: its alias, the note it links, or its role. */
export function entryName(entry: Entry): string {
  if (entry.alias !== undefined) return entry.alias;
  return entry.link === undefined ? ROLES[entry.role].name : target(entry.link);
}

/** Every group, the empty ones included, in the order the note has them. */
export function groups(order: Order): Group[] {
  const found: Group[] = [];
  let at = 0;
  for (const block of order.blocks) {
    if (block.kind === "heading") {
      found.push({ heading: block.heading, role: block.role, entries: [] });
      continue;
    }
    if (block.kind !== "entry") continue;
    // An entry above the first heading is in a group of its own, which
    // the note writes no heading for.
    if (found.length === 0) {
      found.push({ heading: "", role: DEFAULT_ROLE, entries: [] });
    }
    found.at(-1)?.entries.push(at);
    at += 1;
  }
  return found;
}

/**
 * The heading a note added without a place goes under: the first group
 * of chapters, or a group the add makes. A book's later chapter groups
 * are its own; the body is the one it opens with.
 */
export function defaultHeading(order: Order): string {
  const body = groups(order).find((group) => group.role === DEFAULT_ROLE);
  return body?.heading ?? BODY;
}

/**
 * The order with one more entry, at the end of a heading's group, and
 * of the last group of chapters when no heading is named. Every route
 * into the list writes its line with this. A book borrows the note it
 * links: adding never moves or copies it, and a second book may link
 * the same note.
 */
export function add(order: Order, link: string, heading?: string): Order {
  const under = heading ?? defaultHeading(order);
  const group = groups(order).find((found) => found.heading === under);
  return insert(order, link, { heading: under, at: group?.entries.length ?? 0 });
}

/** The order with one more entry at a place in it. */
export function insert(order: Order, link: string, to: Place): Order {
  const role = headingRole(to.heading);
  return into(order, { link, role, heading: to.heading }, to);
}

/**
 * The order with one entry moved. The group it lands in is its role,
 * so a drag across a heading re-roles it and drops the tag that
 * overrode the old heading.
 */
export function move(order: Order, from: number, to: Place): Order {
  const held = entries(order)[from];
  if (held === undefined) return order;

  const group = groups(order).find((found) => found.entries.includes(from));
  const above =
    group?.heading === to.heading && group.entries.indexOf(from) < to.at;
  const moved: Entry = { role: headingRole(to.heading), heading: to.heading };
  if (held.link !== undefined) moved.link = held.link;
  if (held.alias !== undefined) moved.alias = held.alias;

  return into(remove(order, from), moved, {
    heading: to.heading,
    at: above ? to.at - 1 : to.at,
  });
}

/**
 * The order with one entry in a role of its own. A role the entry's
 * heading already gives is written as no tag at all.
 */
export function retag(order: Order, at: number, role: Role): Order {
  return rewrite(order, at, (entry) => {
    const next: Entry = { ...entry, role };
    if (headingRole(entry.heading) === role) delete next.tag;
    else next.tag = role;
    return next;
  });
}

/** The order with one entry pointed at another note. */
export function relink(order: Order, at: number, link: string): Order {
  return rewrite(order, at, (entry) => ({ ...entry, link }));
}

/**
 * The order with one entry taken out, by its place in the reading
 * order. The note stays in the vault.
 */
export function remove(order: Order, at: number): Order {
  let seen = 0;
  const blocks = order.blocks.filter((block) => {
    if (block.kind !== "entry") return true;
    return seen++ !== at;
  });
  return { blocks };
}

/**
 * The reading order against the vault. A generated section has no note
 * to find. A section whose note is gone comes back missing with a
 * warning, and the book is set without it.
 */
export function resolve(order: Order, links: Links, from: string): Resolution {
  const sections: Section[] = [];
  const warnings: Warning[] = [];

  for (const entry of entries(order)) {
    if (ROLES[entry.role].origin === "generated") {
      sections.push({ kind: "generated", entry });
      continue;
    }
    const path =
      entry.link === undefined ? undefined : links.find(entry.link, from);
    if (path === undefined) {
      sections.push({ kind: "missing", entry });
      warnings.push({
        entry,
        said: `the vault has no note called ${entryName(entry)}, and the book is set without it`,
      });
      continue;
    }
    sections.push({ kind: "note", entry, path });
  }
  return { sections, warnings };
}

/**
 * One list item as an entry, or nothing for a line orca cannot read
 * whole. An item tagged with a word that is no role is one of those,
 * and is kept as it was written.
 */
function readEntry(line: string, heading: string, role: Role): Entry | undefined {
  const item = ITEM.exec(line);
  if (item === null) return undefined;
  const [, link, code] = item;
  const tag = code === undefined ? undefined : roleOf(code);
  if (code !== undefined && tag === undefined) return undefined;
  if (link === undefined && tag === undefined) return undefined;

  const entry: Entry = { role: tag ?? role, heading };
  if (link !== undefined) {
    const bar = link.indexOf("|");
    entry.link = (bar < 0 ? link : link.slice(0, bar)).trim();
    if (bar >= 0) entry.alias = link.slice(bar + 1).trim();
  }
  if (tag !== undefined) entry.tag = tag;
  return entry;
}

/**
 * The order with an entry at a place in it. A place under a heading the
 * note does not have makes that heading at the end of the note.
 */
function into(order: Order, entry: Entry, to: Place): Order {
  const blocks = [...order.blocks];
  const at = placeOf(blocks, to);
  if (at !== undefined) {
    blocks.splice(at, 0, { kind: "entry", entry });
    // An entry written against the next heading reads as that group's.
    if (blocks[at + 1]?.kind === "heading") {
      blocks.splice(at + 1, 0, { kind: "other", line: "" });
    }
    return { blocks };
  }

  if (!blank(blocks.at(-1))) blocks.push({ kind: "other", line: "" });
  blocks.push(
    { kind: "heading", line: `# ${to.heading}`, heading: to.heading, role: entry.role },
    { kind: "other", line: "" },
    { kind: "entry", entry },
    { kind: "other", line: "" },
  );
  return { blocks };
}

/** The order with one entry made again, by its place in the reading order. */
function rewrite(order: Order, at: number, made: (entry: Entry) => Entry): Order {
  let seen = 0;
  const blocks = order.blocks.map((block) => {
    if (block.kind !== "entry") return block;
    const held = seen;
    seen += 1;
    return held === at ? { kind: "entry" as const, entry: made(block.entry) } : block;
  });
  return { blocks };
}

/**
 * Which block a place is, or nothing if the body has no such heading.
 * A place past the group's last entry is the end of the group, and the
 * group with no heading is what the body opens with.
 */
function placeOf(blocks: Block[], to: Place): number | undefined {
  const head =
    to.heading === ""
      ? -1
      : blocks.findIndex(
          (block) => block.kind === "heading" && block.heading === to.heading,
        );
  if (head < 0 && to.heading !== "") return undefined;

  let at = head + 1;
  let seen = 0;
  // A group opens with a blank line, and the entries go under it. A
  // group of the author's own prose keeps that prose below them.
  let opening = true;
  for (let next = head + 1; next < blocks.length; next += 1) {
    const block = blocks[next];
    if (block === undefined || block.kind === "heading") break;
    if (block.kind === "entry") {
      if (seen === to.at) return next;
      seen += 1;
      opening = false;
      at = next + 1;
    } else if (!blank(block)) opening = false;
    else if (opening) at = next + 1;
  }
  return at;
}

function blank(block: Block | undefined): boolean {
  return block !== undefined && block.kind === "other" && block.line.trim() === "";
}
