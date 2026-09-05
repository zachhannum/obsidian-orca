/**
 * A note's properties, and the body under them.
 *
 * Obsidian parses a note's frontmatter into the metadata cache and
 * writes it through its own API. Orca reads the same block itself, so
 * the Node tier opens a book with no application around it, and writes
 * one to create a book note.
 */

/** One property's value. */
export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value };

export type Properties = Record<string, Value>;

/** A note, split at the frontmatter fence. */
export interface Note {
  properties: Properties;
  /** Everything after the fence, its newline included. */
  body: string;
}

const FENCE = "---";

/**
 * A note's properties and its body. A note that does not open with a
 * fence has no properties and is all body.
 */
export function readFrontmatter(text: string): Note {
  const lines = text.split("\n");
  if (fenced(lines, 0) !== true) return { properties: {}, body: text };

  const end = lines.findIndex((line, at) => at > 0 && line.trim() === FENCE);
  if (end < 0) return { properties: {}, body: text };

  const head = lines.slice(0, end + 1).join("\n");
  return {
    properties: properties(lines.slice(1, end)),
    body: text.slice(head.length),
  };
}

/**
 * A note as text. Properties are written in the order they are given,
 * one key per line, and `quoted` names the keys written as strings
 * whatever their value is.
 */
export function writeFrontmatter(
  note: Note,
  quoted: ReadonlySet<string> = new Set(),
): string {
  const lines = [FENCE];
  for (const [key, property] of Object.entries(note.properties)) {
    if (Array.isArray(property)) {
      lines.push(`${key}:`, ...property.map((item) => `  - ${encode(item)}`));
      continue;
    }
    const value = encode(property, quoted.has(key));
    lines.push(value === "" ? `${key}:` : `${key}: ${value}`);
  }
  lines.push(FENCE);
  return lines.join("\n") + note.body;
}

function properties(lines: string[]): Properties {
  const found: Properties = {};
  let list: Value[] | undefined;
  let key = "";

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item !== null && list !== undefined) {
      list.push(decode(item[1] ?? ""));
      found[key] = list;
      continue;
    }

    const named = /^(\S[^:]*):(.*)$/.exec(line);
    if (named === null) continue;
    key = named[1] ?? "";
    const rest = (named[2] ?? "").trim();
    // A key with nothing after it is either empty or the head of a
    // list, which the next line settles.
    list = rest === "" ? [] : undefined;
    found[key] = rest === "" ? null : decode(rest);
  }
  return found;
}

/**
 * One scalar, read the way a YAML parser reads it: `no` is boolean
 * false, `1.5` is a number, and quotes are what make either a string.
 */
function decode(text: string): Value {
  const quoted = /^"(.*)"$/.exec(text) ?? /^'(.*)'$/.exec(text);
  if (quoted !== null) return (quoted[1] ?? "").replace(/\\"/g, '"');
  if (/^(null|~)$/i.test(text)) return null;
  if (/^(true|yes|on)$/i.test(text)) return true;
  if (/^(false|no|off)$/i.test(text)) return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/**
 * One scalar, written so that reading it back gives what was written.
 * A string a parser would read as something else is quoted, and so is
 * every key `quoted` names.
 */
function encode(value: Value, quote = false): string {
  if (value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return JSON.stringify(value);
  const plain =
    value !== "" && value === decode(value) && !/^[\s#-]|[:#]\s|\s$/.test(value);
  return quote || !plain ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function fenced(lines: string[], at: number): boolean {
  return (lines[at] ?? "").replace(/\r$/, "") === FENCE;
}
