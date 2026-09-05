/**
 * The note a wikilink names.
 *
 * Obsidian rewrites the links inside a note through a rename and a
 * move, so an entry has a link and the note is resolved at every
 * read. Orca keeps no path of its own.
 */

/** How a link finds its note. `ui` resolves one through the metadata cache. */
export interface Links {
  /**
   * The vault path a link names, seen from the note it is in, or
   * nothing if the vault has no such note.
   */
  find(link: string, from: string): string | undefined;
}

/**
 * Links resolved against a list of vault paths, the way Obsidian
 * resolves them: the note of that name nearest the note the link is
 * in, and the shortest path when two are equally near.
 */
export function pathLinks(paths: Iterable<string>): Links {
  const all = [...paths];
  return {
    find(link, from) {
      const wanted = target(link);
      if (wanted === "") return undefined;
      const named = wanted.endsWith(".md") ? wanted : `${wanted}.md`;
      const found = all.filter(
        (path) =>
          path === wanted ||
          path === named ||
          path.endsWith(`/${wanted}`) ||
          path.endsWith(`/${named}`),
      );
      return nearest(found, from);
    },
  };
}

/**
 * Every wikilink in a stretch of text, as written. A paste into the
 * navigator is read with this, so a pasted link and a picked note write
 * the same line.
 */
export function linksIn(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].flatMap((found) => {
    const link = (found[1] ?? "").trim();
    return link === "" ? [] : [link];
  });
}

/** The note a link names, without its alias, its heading or its block. */
export function target(link: string): string {
  const name = link.split("|")[0] ?? "";
  return (name.split(/[#^]/)[0] ?? "").trim();
}

function nearest(found: string[], from: string): string | undefined {
  const home = from.slice(0, from.lastIndexOf("/") + 1);
  const sorted = [...found].sort(
    (a, b) =>
      away(a, home) - away(b, home) ||
      depth(a) - depth(b) ||
      a.localeCompare(b),
  );
  return sorted[0];
}

function away(path: string, home: string): number {
  return path.startsWith(home) ? 0 : 1;
}

function depth(path: string): number {
  return path.split("/").length;
}
