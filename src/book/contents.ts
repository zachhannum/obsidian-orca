/**
 * The generated contents, as markdown the engine sets. Each entry is a
 * markdown link to a note, and the engine prints the page the link
 * lands on. The engine sets no list, so each entry is its own
 * paragraph.
 */

/** One line of the contents: the words it shows and where it links. */
export interface Listed {
  label: string;
  /** The note's vault path. */
  path: string;
  /** The heading the link lands on. With none, it lands on the start of the note. */
  heading?: string;
}

/**
 * The text of a note's first ATX heading. Frontmatter at the top and
 * fenced code are not read, so a `#` line in either is not a heading.
 */
export function firstHeading(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  let at = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end !== -1) at = end + 1;
  }
  let fence: string | undefined;
  for (; at < lines.length; at++) {
    const line = lines[at] ?? "";
    const opens = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== undefined) {
      if (opens?.[1] !== undefined && opens[1][0] === fence[0] && opens[1].length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (opens?.[1] !== undefined) {
      fence = opens[1];
      continue;
    }
    const heading = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (heading) {
      const words = (heading[1] ?? "").replace(/^#+$/, "").trim();
      if (words !== "") return words;
    }
  }
  return undefined;
}

/** The contents section's markdown: its title, then one link per entry. */
export function contentsMarkdown(title: string, entries: readonly Listed[]): string {
  return [`# ${title}`, ...entries.map(link)].join("\n\n");
}

function link(entry: Listed): string {
  const label = entry.label.replace(/[\\[\]]/g, (mark) => `\\${mark}`);
  const path = entry.path.split("/").map(encoded).join("/");
  const at = entry.heading === undefined ? "" : `#${encoded(entry.heading)}`;
  return `[${label}](${path}${at})`;
}

// A bare paren could close the link early, so it is encoded too.
function encoded(part: string): string {
  return encodeURIComponent(part).replace(
    /[!'()*]/g,
    (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
