/**
 * The images a manuscript names, as the urls the engine keys them by.
 *
 * The engine opens no file, so an image reaches it as bytes under the
 * url written in the source. Layout places the image by that url, and a
 * painter draws the pixels from it.
 *
 * The scan reads the text rather than parsing it, so a url in a code
 * fence is fetched too. That costs one crossing and nothing else. An
 * embed the scan misses crosses no bytes, and the engine warns about
 * the url.
 */

import { readFrontmatter } from "@/book/frontmatter";

/** One image a source names. */
export interface Embed {
  /** The url as it is written in the source, which the engine keys the bytes on. */
  url: string;
  /** The same url as a link the vault resolves. A markdown url is percent-decoded. */
  link: string;
}

/** `![[file]]`, with the size or the alias after a pipe left off. */
const WIKI = /!\[\[([^\]]+)\]\]/g;

/** `![alt](file)`, with a title after the url left off. */
const INLINE = /!\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)/g;

/** A url outside the vault. */
const REMOTE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Every image the body of a source names, in the order it names them,
 * each url once. A url outside the vault is not one of them. Orca reads
 * the vault and nothing else, so such a url crosses no bytes and the
 * engine warns about it.
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

/** The url with its percent escapes decoded, which is the path the vault resolves. */
function decoded(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    // A url with no escapes in it resolves as it was written.
    return url;
  }
}
