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

/**
 * The order with one more entry, at the end of a heading's group. A
 * book borrows the note it links: adding never moves or copies it, and
 * a second book may link the same note.
 */
export function add(order: Order, link: string, heading: string): Order {
  const blocks = [...order.blocks];
  const role = headingRole(heading);
  const entry: Entry = { link, role, heading };
  const at = endOf(blocks, heading);

  if (at === undefined) {
    if (!blank(blocks.at(-1))) blocks.push({ kind: "other", line: "" });
    blocks.push(
      { kind: "heading", line: `# ${heading}`, heading, role },
      { kind: "other", line: "" },
      { kind: "entry", entry },
      { kind: "other", line: "" },
    );
    return { blocks };
  }
  blocks.splice(at, 0, { kind: "entry", entry });
  return { blocks };
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
 * Where a new entry goes in a heading's group, or nothing if the body
 * has no such heading.
 */
function endOf(blocks: Block[], heading: string): number | undefined {
  const head = blocks.findIndex(
    (block) => block.kind === "heading" && block.heading === heading,
  );
  if (head < 0) return undefined;

  let at = head + 1;
  let seen = false;
  for (let next = head + 1; next < blocks.length; next += 1) {
    const block = blocks[next];
    if (block === undefined || block.kind === "heading") break;
    if (block.kind === "entry") {
      seen = true;
      at = next + 1;
    } else if (!seen && blank(block)) at = next + 1;
  }
  return at;
}

function blank(block: Block | undefined): boolean {
  return block !== undefined && block.kind === "other" && block.line.trim() === "";
}
