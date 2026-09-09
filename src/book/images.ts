/**
 * The images a manuscript names, as the engine will ask for them.
 *
 * The engine opens nothing, so an image reaches it as bytes under the
 * url the source wrote. That url is the key on both sides: layout
 * places the image by it, and a painter takes it back to its own
 * pixels.
 *
 * The scan is a reading of the text rather than a parse of it, so a url
 * in a code fence is fetched too. That costs one crossing the engine
 * never asks about and nothing else; an embed the scan misses is a
 * warning from the run that wanted it.
 */

import { readFrontmatter } from "@/book/frontmatter";

/** One image a source names. */
export interface Embed {
  /** The url as the source wrote it, which is what the engine keys the bytes on. */
  url: string;
  /** The same as a link the vault resolves: a markdown url is percent-decoded. */
  link: string;
}

/** `![[file]]`, with the size or the alias after a pipe left off. */
const WIKI = /!\[\[([^\]]+)\]\]/g;

/** `![alt](file)`, with a title after the url left off. */
const INLINE = /!\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)/g;

/** A url that names somewhere other than the vault. */
const REMOTE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Every image the body of a source names, in the order it names them,
 * each url once. A remote url is not one of them: orca reads the vault
 * and nothing else, so the engine is left to say what it was without.
 */
export function imagesIn(text: string): Embed[] {
  const { body } = readFrontmatter(text);
  const found = new Map<string, Embed>();
  for (const embed of [...wikilinks(body), ...inlines(body)]) {
    if (REMOTE.test(embed.url) || found.has(embed.url)) continue;
    found.set(embed.url, embed);
  }
  return [...found.values()];
}

function* wikilinks(body: string): Generator<Embed> {
  for (const found of body.matchAll(WIKI)) {
    const url = (found[1] ?? "").split("|")[0]?.trim() ?? "";
    if (url !== "") yield { url, link: url };
  }
}

function* inlines(body: string): Generator<Embed> {
  for (const found of body.matchAll(INLINE)) {
    const written = found[1] ?? "";
    const url = written.startsWith("<") ? written.slice(1, -1) : written;
    if (url === "") continue;
    yield { url, link: decoded(url) };
  }
}

/** A url a link resolver reads, for one written with the escapes a url takes. */
function decoded(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    // A url that is not encoded at all resolves as it was written.
    return url;
  }
}
