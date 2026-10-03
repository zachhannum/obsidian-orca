/**
 * Works out what the EPUB view's status line says: the title the book's
 * own table of contents gives the document being read, the page within
 * it, and how far through the book that is. The files are the engine's,
 * so the table of contents is read with patterns rather than a parser,
 * and the Node tier runs all of it.
 */

import { resolvePath, type Bindable } from "@/ui/frame";

/** One document of the spine, as the status line counts it. */
export interface Chapter {
  /** The title the table of contents gives it, or nothing for a document it does not list. */
  title: string | undefined;
  /** Its size in bytes, which stands in for its length. */
  length: number;
}

const PACKAGE = "application/oebps-package+xml";
const NCX = "application/x-dtbncx+xml";

/**
 * The documents of the spine that have a file, in reading order, which
 * are the ones `bindFiles` binds. A document the table of contents
 * lists more than once takes the first title it is listed under.
 */
export function chapters(book: Bindable): Chapter[] {
  const titles = contents(book);
  const found: Chapter[] = [];
  for (const path of book.spine) {
    const file = book.files.find((candidate) => candidate.path === path);
    if (file === undefined) continue;
    found.push({ title: titles.get(path), length: file.bytes.length });
  }
  return found;
}

/**
 * The titles the table of contents gives, by the path of the document
 * each entry points at. The nav document is read first and `toc.ncx`
 * only when there is none.
 */
function contents(book: Bindable): Map<string, string> {
  const text = new TextDecoder();
  const read = (path: string): string | undefined => {
    const file = book.files.find((candidate) => candidate.path === path);
    return file === undefined ? undefined : text.decode(file.bytes);
  };
  const opf = book.files.find((file) => file.mediaType === PACKAGE);
  const titles = new Map<string, string>();
  if (opf === undefined) return titles;
  const manifest = text.decode(opf.bytes);
  const items = Array.from(manifest.matchAll(/<item\b[^>]*>/g), (match) => match[0]);

  const nav = items.find((item) => /\bnav\b/.test(attribute(item, "properties") ?? ""));
  const navHref = nav === undefined ? undefined : attribute(nav, "href");
  const navPath = navHref === undefined ? undefined : resolvePath(opf.path, navHref);
  const navText = navPath === undefined ? undefined : read(navPath);
  if (navPath !== undefined && navText !== undefined) {
    const toc = /<nav\b[^>]*\btype\s*=\s*["'][^"']*\btoc\b[^>]*>([\s\S]*?)<\/nav>/i.exec(navText);
    for (const link of (toc?.[1] ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      list(titles, navPath, attribute(link[0], "href"), link[2] ?? "");
    }
    return titles;
  }

  const ncx = items.find((item) => attribute(item, "media-type") === NCX);
  const ncxHref = ncx === undefined ? undefined : attribute(ncx, "href");
  const ncxPath = ncxHref === undefined ? undefined : resolvePath(opf.path, ncxHref);
  const ncxText = ncxPath === undefined ? undefined : read(ncxPath);
  if (ncxPath === undefined || ncxText === undefined) return titles;
  const point =
    /<navLabel\b[^>]*>\s*<text\b[^>]*>([\s\S]*?)<\/text>\s*<\/navLabel>\s*(<content\b[^>]*>)/gi;
  for (const entry of ncxText.matchAll(point)) {
    list(titles, ncxPath, attribute(entry[2] ?? "", "src"), entry[1] ?? "");
  }
  return titles;
}

/** Lists a title under the document `href` points at, unless one is listed there already. */
function list(
  titles: Map<string, string>,
  from: string,
  href: string | undefined,
  markup: string,
): void {
  const path = href === undefined ? undefined : resolvePath(from, href);
  const title = plain(markup);
  if (path === undefined || title === "" || titles.has(path)) return;
  titles.set(path, title);
}

/** The value of an attribute in a start tag, with its entities decoded. */
function attribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const found = pattern.exec(tag);
  if (found === null) return undefined;
  return entities(found[1] ?? found[2] ?? "");
}

/** The words of some markup, with its tags dropped and its spaces run together. */
function plain(markup: string): string {
  return entities(markup.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function entities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

/**
 * The whole percent of the book read at a page, weighting each
 * document by its length. It is 100 only on the last page of the last
 * document, so a reader who sees 100 has nothing left to read.
 */
export function percent(lengths: readonly number[], section: number, page: number, pages: number): number {
  const last = section === lengths.length - 1 && page === pages;
  if (last) return 100;
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return 0;
  const before = lengths.slice(0, section).reduce((sum, length) => sum + length, 0);
  const into = ((lengths[section] ?? 0) * (page - 1)) / Math.max(pages, 1);
  return Math.min(Math.floor(((before + into) / total) * 100), 99);
}

/** The parts of the status line: the title, which may be cut short, and the place, which never is. */
export interface Status {
  title: string | undefined;
  place: string;
}

/** The status line for page `page` of `pages` of the document at `section`, counting pages from 1. */
export function status(
  read: readonly Chapter[],
  section: number,
  page: number,
  pages: number,
): Status {
  const lengths = read.map((chapter) => chapter.length);
  return {
    title: read[section]?.title,
    place:
      `page ${String(page)} of ${String(pages)} · ` +
      `${String(percent(lengths, section, page, pages))}%`,
  };
}

/** The status line as one line of text. */
export function statusText(line: Status): string {
  return line.title === undefined ? line.place : `${line.title} · ${line.place}`;
}
