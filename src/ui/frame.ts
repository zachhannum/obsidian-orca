/**
 * Binds a book's EPUB files to URLs a frame can load, and works out the
 * turns and the fit of the frame that shows them. Nothing here reaches
 * the document at import, so the Node tier runs all of it but
 * `rewriteDocument`.
 */

/** One file of the EPUB, as the engine writes it. */
export interface BookFile {
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}

/** One document of the spine. */
export interface SpineEntry {
  path: string;
  /** The node of the section the document holds, or nothing for the one document of an empty book. */
  section: number | null;
}

/** The files a frame reads, and its documents in reading order. */
export interface Bindable {
  spine: readonly SpineEntry[];
  files: readonly BookFile[];
}

/** One value for each of the three ReadiumCSS sheets. */
export interface Sheets<Value> {
  before: Value;
  fallback: Value;
  after: Value;
}

/** The names a document's ReadiumCSS sheets carry in `data-readium`. */
export type SheetName = "before" | "default" | "after";

/**
 * The files a document's references are rewritten to. A sheet is text
 * rather than a URL: the frame inherits Obsidian's content security
 * policy, which loads no stylesheet from a blob and does allow one
 * written into the document.
 */
export interface Links {
  /** The URL of the file at a path, or nothing for a path the book has no file at. */
  url(path: string): string | undefined;
  /** The text of the sheet at a path, with its own references rewritten. */
  sheet(path: string): string | undefined;
  /** The text of the ReadiumCSS sheets. */
  sheets: Sheets<string>;
}

/** A reader's place: a document of the spine and a screen of it, both counting from 0. */
export interface Place {
  section: number;
  /** `last` is the last screen of a document nobody has counted yet. */
  screen: number | "last";
  /**
   * The elements the place was asked for by, the nearest first. The
   * screen is the one that holds the first of them the document has,
   * which is not known until the document is laid out.
   */
  by?: readonly number[];
}

/**
 * A place by the engine's nodes: a section, and the elements around a
 * node inside it, the nearest first. A node names a place only until
 * the next edit.
 */
export interface Anchor {
  /** The generation the nodes are of. */
  generation: number;
  section: number;
  nodes: readonly number[];
}

/** A block of a laid out document: its node, and the left edge of its first box, in pixels from the start of the document. */
export interface Laid {
  node: number;
  left: number;
}

/** The blocks a screen begins and ends on. */
export interface Opening {
  /** The first block that begins on the screen, or the block the screen opens inside. */
  opens: number | undefined;
  /** The last block that begins on the screen, or the one it opens inside. */
  closes: number | undefined;
  /** Whether a block begins on the screen, which makes `opens` a place a new layout can find the screen by. */
  begun: boolean;
}

/**
 * The document that holds a section, found by the section's node. A
 * count down the spine finds the wrong one where the book set nothing
 * from a section, or where a document has no file.
 */
export function documentOf(documents: readonly Document[], section: number): number | undefined {
  const at = documents.findIndex((document) => document.section === section);
  return at < 0 ? undefined : at;
}

/** The screen a left edge is on, counting from 0, in a document of `screens` screens. */
export function screenOf(left: number, width: number, screens: number): number {
  if (width <= 0) return 0;
  return Math.min(Math.max(Math.floor(left / width), 0), Math.max(screens - 1, 0));
}

/** The left edge of the first of these nodes the document has a box for. */
export function leftOf(laid: readonly Laid[], nodes: readonly number[]): number | undefined {
  for (const node of nodes) {
    const found = laid.find((block) => block.node === node);
    if (found !== undefined) return found.left;
  }
  return undefined;
}

/**
 * The blocks one screen opens and closes with. The blocks are in the
 * order the document holds them. A screen no block begins on is inside
 * one long block, and it opens and closes with that block.
 */
export function openingOf(laid: readonly Laid[], screen: number, width: number): Opening {
  let before: number | undefined;
  let opens: number | undefined;
  let closes: number | undefined;
  for (const block of laid) {
    const on = width <= 0 ? 0 : Math.floor(block.left / width);
    if (on < screen) before = block.node;
    if (on !== screen) continue;
    opens ??= block.node;
    closes = block.node;
  }
  return { opens: opens ?? before, closes: closes ?? before, begun: opens !== undefined };
}

export interface Box {
  width: number;
  height: number;
}

const XHTML = "application/xhtml+xml";
const CSS = "text/css";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The path a reference in the file at `from` names, with its query and
 * fragment dropped. Nothing for a reference that leaves the book, or
 * that names a place in the same file.
 */
export function resolvePath(from: string, reference: string): string | undefined {
  const named = reference.trim().replace(/[?#].*$/, "");
  if (named === "" || SCHEME.test(named) || named.startsWith("//")) return undefined;
  const parts = named.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of named.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(decoded(part));
  }
  return parts.join("/");
}

function decoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

const URL_CALL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/g;

/**
 * Points every `url()` of a sheet that names a file of the book at that
 * file's URL. A blob has no folder, so a relative reference left in a
 * sheet would resolve to nothing.
 */
export function rewriteSheet(
  path: string,
  css: string,
  url: (path: string) => string | undefined,
): string {
  return css.replace(URL_CALL, (call, double?: string, single?: string, bare?: string) => {
    const resolved = resolvePath(path, double ?? single ?? bare ?? "");
    const bound = resolved === undefined ? undefined : url(resolved);
    return bound === undefined ? call : `url("${bound}")`;
  });
}

/**
 * The ReadiumCSS sheets a document takes, in the order of its head. The
 * default sheet is for a document with no stylesheet of its own.
 */
export function sheetOrder(styled: boolean): SheetName[] {
  return styled ? ["before", "after"] : ["before", "default", "after"];
}

/**
 * The place `step` screens on from `at`, in a document of `screens`
 * screens. A turn off either end of a document goes to the document
 * beside it. Nothing for a turn off either end of the book.
 */
export function turnedBy(
  at: { section: number; screen: number },
  step: number,
  screens: number,
  sections: number,
): Place | undefined {
  const screen = at.screen + step;
  if (screen >= 0 && screen < screens) return { section: at.section, screen };
  if (step > 0) {
    return at.section + 1 < sections ? { section: at.section + 1, screen: 0 } : undefined;
  }
  return at.section > 0 ? { section: at.section - 1, screen: "last" } : undefined;
}

const STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  PageDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  PageUp: -1,
};

/** The screens a key turns by, or nothing for a key that turns none. */
export function stepOf(key: string): number | undefined {
  return STEPS[key];
}

/** The scale that fits a device, body included, in the well. It never enlarges the device. */
export function fitted(device: Box, well: Box): number {
  if (well.width <= 0 || well.height <= 0) return 1;
  return Math.min(1, well.width / device.width, well.height / device.height);
}

/** A frame as the window draws it: its corner, and the scale it is drawn at. */
export interface Drawn {
  left: number;
  top: number;
  scale: number;
}

/**
 * The point in the window that a point inside a frame is drawn at. An
 * event inside the frame is measured from the frame's own corner, in
 * pixels the scale has not touched.
 */
export function windowPoint(frame: Drawn, x: number, y: number): { x: number; y: number } {
  return { x: frame.left + x * frame.scale, y: frame.top + y * frame.scale };
}

/** The keys that zoom while Ctrl or Cmd is held. */
const ZOOM_KEYS = new Set(["=", "+", "-", "0"]);

/**
 * Whether a key pressed inside the frame is one the pane answers: a
 * turn, the Space that moves a zoomed device, or a zoom. The frame's
 * keys never reach the pane, so the frame sends these on.
 */
export function paneKey(key: string, mod: boolean): boolean {
  return key === " " || stepOf(key) !== undefined || (mod && ZOOM_KEYS.has(key));
}

/** A document a frame can load, and the node of the section it holds. */
export interface Document {
  url: string;
  section: number | null;
}

/** The spine's documents, and the call that releases every URL made for them. */
export interface Bound {
  documents: Document[];
  revoke: () => void;
}

/**
 * Makes a URL for each image, font and document of the book. A file is
 * bound after the files it names, so each reference is rewritten to a
 * URL that already exists. Images and fonts go first, then the sheets
 * are rewritten, then the documents take the sheets as text.
 */
export function bindFiles(
  book: Bindable,
  sheets: Sheets<string>,
  make: (body: Uint8Array | string, mediaType: string) => string,
  revoke: (url: string) => void,
  rewrite: (path: string, xhtml: string, links: Links) => string,
): Bound {
  const made: string[] = [];
  const bind = (body: Uint8Array | string, mediaType: string): string => {
    const url = make(body, mediaType);
    made.push(url);
    return url;
  };
  const urls = new Map<string, string>();
  const url = (path: string): string | undefined => urls.get(path);
  const text = new TextDecoder();

  for (const file of book.files) {
    if (file.mediaType === CSS || file.mediaType === XHTML) continue;
    urls.set(file.path, bind(file.bytes, file.mediaType));
  }
  const written = new Map<string, string>();
  for (const file of book.files) {
    if (file.mediaType !== CSS) continue;
    written.set(file.path, rewriteSheet(file.path, text.decode(file.bytes), url));
  }
  const links: Links = { url, sheet: (path) => written.get(path), sheets };
  const documents: Document[] = [];
  for (const { path, section } of book.spine) {
    const file = book.files.find((candidate) => candidate.path === path);
    if (file === undefined) continue;
    documents.push({ url: bind(rewrite(path, text.decode(file.bytes), links), XHTML), section });
  }
  return {
    documents,
    revoke: () => {
      for (const each of made.splice(0)) revoke(each);
    },
  };
}

const READIUM = "data-readium";
const XHTML_SPACE = "http://www.w3.org/1999/xhtml";

/**
 * Rewrites one document of the book for a frame that loads it from a
 * blob. Its references go to the URLs of the files they name, each
 * sheet it links is written into it, its head takes the ReadiumCSS
 * sheets, and its links stop being links: a link a frame followed
 * would load a document that has no ReadiumCSS.
 */
export function rewriteDocument(path: string, xhtml: string, links: Links): string {
  const parsed = new DOMParser().parseFromString(xhtml, XHTML);
  const head = parsed.querySelector("head");
  if (head === null) return xhtml;
  const sheet = (css: string): Element => {
    const style = parsed.createElementNS(XHTML_SPACE, "style");
    style.textContent = css;
    return style;
  };
  for (const link of Array.from(parsed.querySelectorAll("link[href]"))) {
    const resolved = resolvePath(path, link.getAttribute("href") ?? "");
    const css = resolved === undefined ? undefined : links.sheet(resolved);
    if (css === undefined) point(link, "href", path, links);
    else link.replaceWith(sheet(css));
  }
  for (const element of Array.from(parsed.querySelectorAll("[src]"))) {
    point(element, "src", path, links);
  }
  for (const anchor of Array.from(parsed.querySelectorAll("a[href]"))) {
    anchor.setAttribute("data-href", anchor.getAttribute("href") ?? "");
    anchor.removeAttribute("href");
  }
  const styled = parsed.querySelector('style, link[rel~="stylesheet"]') !== null;
  const texts: Record<SheetName, string> = {
    before: links.sheets.before,
    default: links.sheets.fallback,
    after: links.sheets.after,
  };
  const first = head.firstChild;
  for (const name of sheetOrder(styled)) {
    const style = sheet(texts[name]);
    style.setAttribute(READIUM, name);
    if (name === "after") head.append(style);
    else head.insertBefore(style, first);
  }
  return new XMLSerializer().serializeToString(parsed);
}

function point(element: Element, attribute: string, path: string, links: Links): void {
  const resolved = resolvePath(path, element.getAttribute(attribute) ?? "");
  const bound = resolved === undefined ? undefined : links.url(resolved);
  if (bound !== undefined) element.setAttribute(attribute, bound);
}
