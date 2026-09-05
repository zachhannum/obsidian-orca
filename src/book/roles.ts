/**
 * A role sets which generated CSS a section gets, and whether its text
 * comes from a note.
 */

/** Where a section's text comes from. */
export type Origin = "note" | "generated";

/** One role: whether a section in it comes from a note, and what it is called. */
export interface Matter {
  origin: Origin;
  /** What a section in this role is called when it has no note. */
  name: string;
}

const MATTER = {
  "title-page": { origin: "generated", name: "Title page" },
  copyright: { origin: "note", name: "Copyright" },
  dedication: { origin: "note", name: "Dedication" },
  epigraph: { origin: "note", name: "Epigraph" },
  contents: { origin: "generated", name: "Contents" },
  "front-matter": { origin: "note", name: "Front matter" },
  part: { origin: "note", name: "Part" },
  chapter: { origin: "note", name: "Chapter" },
  "back-matter": { origin: "note", name: "Back matter" },
} as const satisfies Record<string, Matter>;

export type Role = keyof typeof MATTER;

/** Every role, in the order the format lists them. */
export const ROLES: Readonly<Record<Role, Matter>> = MATTER;

/** The role an entry takes when neither its tag nor its heading names one. */
export const DEFAULT_ROLE: Role = "chapter";

/** The role a tag names, or nothing if it names none. */
export function roleOf(tag: string): Role | undefined {
  const name = tag.trim();
  return Object.hasOwn(MATTER, name) ? (name as Role) : undefined;
}

/**
 * The role an entry under this heading has, when the entry itself
 * has no tag. A heading whose words name a role is that role,
 * and every other heading is `chapter`.
 */
export function headingRole(heading: string): Role {
  return roleOf(heading.trim().toLowerCase().replace(/\s+/g, "-")) ?? DEFAULT_ROLE;
}
