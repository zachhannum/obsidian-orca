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
    effect: "Generated from the book's details. A linked note is not set.",
  },
  copyright: {
    origin: "note",
    name: "Copyright",
    effect: "Small type at the foot of the page.",
  },
  dedication: {
    origin: "note",
    name: "Dedication",
    effect: "Centered, down the page.",
  },
  epigraph: {
    origin: "note",
    name: "Epigraph",
    effect: "Narrow, with the last paragraph set right.",
  },
  contents: {
    origin: "generated",
    name: "Contents",
    effect: "Generated from the reading order. A linked note is not set.",
  },
  "front-matter": {
    origin: "note",
    name: "Front matter",
    effect: "Prose before the chapters, such as a preface.",
  },
  part: {
    origin: "note",
    name: "Part",
    effect: "A title page for a group of chapters.",
  },
  chapter: {
    origin: "note",
    name: "Chapter",
    effect: "The default role, with the chapter opening.",
  },
  "back-matter": {
    origin: "note",
    name: "Back matter",
    effect: "Prose after the chapters, such as an afterword.",
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
