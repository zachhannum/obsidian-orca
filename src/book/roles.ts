/**
 * A role sets which generated CSS a section gets, and whether its text
 * comes from a note.
 */

/** The source of a section's text. */
export type Origin = "note" | "generated";

/** One role: whether a section in it comes from a note, and what it is called. */
export interface Matter {
  origin: Origin;
  /** The default name for a section in this role that has no note. */
  name: string;
  /** One line a picker shows under the name: what the role does to the typeset book. */
  effect: string;
}

const MATTER = {
  "title-page": {
    origin: "generated",
    name: "Title page",
    effect: "Sets the title and the author from the book's details. The text of a linked note is not set.",
  },
  copyright: {
    origin: "note",
    name: "Copyright",
    effect: "A single page in small type, at the foot of the page. The contents does not list it.",
  },
  dedication: {
    origin: "note",
    name: "Dedication",
    effect: "A single page, centered and down the page. The contents does not list it.",
  },
  epigraph: {
    origin: "note",
    name: "Epigraph",
    effect: "A single page to a narrow measure, with its last paragraph set to the right.",
  },
  contents: {
    origin: "generated",
    name: "Contents",
    effect: "Lists the parts, the chapters and the other prose with their pages. The text of a linked note is not set.",
  },
  "front-matter": {
    origin: "note",
    name: "Front matter",
    effect: "Prose that is not a chapter, such as a preface. The contents lists it, and it takes no drop cap.",
  },
  part: {
    origin: "note",
    name: "Part",
    effect: "A title page for a group of chapters. The first part or chapter is page 1.",
  },
  chapter: {
    origin: "note",
    name: "Chapter",
    effect: "A chapter of the body. The first part or chapter is page 1.",
  },
  "back-matter": {
    origin: "note",
    name: "Back matter",
    effect: "Prose that is not a chapter, such as an afterword. The contents lists it, and it takes no drop cap.",
  },
} as const satisfies Record<string, Matter>;

export type Role = keyof typeof MATTER;

/** Every role, in the order the format lists them. */
export const ROLES: Readonly<Record<Role, Matter>> = MATTER;

/** The role an entry takes when it names none of its own. */
export const DEFAULT_ROLE: Role = "chapter";

/** The role a tag names, or nothing if it names none. */
export function roleOf(tag: string): Role | undefined {
  const name = tag.trim();
  return Object.hasOwn(MATTER, name) ? (name as Role) : undefined;
}

/** The index of the first part or chapter, where the body starts and page 1 with it. */
export function bodyStart(roles: readonly Role[]): number | undefined {
  const found = roles.findIndex((role) => role === "part" || role === "chapter");
  return found === -1 ? undefined : found;
}
