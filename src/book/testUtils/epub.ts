/**
 * An exported EPUB, opened by a test: the files in the zip, and the
 * text a reading app prints from them.
 */

/** The record that ends a zip, and one file's record in its directory. */
const END = 0x06054b50;
const ENTRY = 0x02014b50;

/** The compression method of a file the zip stores as it is. */
const STORED = 0;

/** The elements that end a line, so the words either side stay apart. */
const BLOCK = /<\/(?:p|h[1-6]|li|div|section|nav|blockquote|pre|figcaption|td|th|dt|dd|title)>|<[bh]r\b[^>]*>/g;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The files of a zip by their paths, each inflated. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END) end -= 1;
  if (end < 0) throw new Error("the file is not a zip");

  const files = new Map<string, Uint8Array>();
  let at = view.getUint32(end + 16, true);
  for (let left = view.getUint16(end + 10, true); left > 0; left -= 1) {
    if (view.getUint32(at, true) !== ENTRY) throw new Error("the zip's directory is cut short");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const name = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + name));
    // A file's own header repeats its name, with extra fields of its own length.
    const from = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const held = bytes.subarray(from, from + size);
    files.set(path, method === STORED ? held : await inflated(held));
    at += 46 + name + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

async function inflated(held: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(held)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The text of the documents in an EPUB's spine, in reading order. The
 * navigation document is read only where the spine names it.
 */
export async function epubText(bytes: Uint8Array): Promise<string> {
  const files = await unzip(bytes);
  const read = (path: string): string => {
    const file = files.get(path);
    if (file === undefined) throw new Error(`the EPUB has no ${path}`);
    return new TextDecoder().decode(file);
  };

  const opf = /<rootfile\b[^>]*\bfull-path="([^"]+)"/.exec(read("META-INF/container.xml"))?.[1];
  if (opf === undefined) throw new Error("the EPUB names no package document");
  const folder = opf.includes("/") ? opf.slice(0, opf.lastIndexOf("/") + 1) : "";
  const pkg = read(opf);
  const hrefs = new Map<string, string>();
  for (const [item] of pkg.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(item)?.[1];
    const href = /\bhref="([^"]+)"/.exec(item)?.[1];
    if (id !== undefined && href !== undefined) hrefs.set(id, href);
  }

  return [...pkg.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)]
    .map(([, id]) => {
      const href = hrefs.get(id ?? "");
      if (href === undefined) throw new Error(`the spine names ${id ?? ""}, which the manifest lacks`);
      return printed(read(folder + decodeURI(href)));
    })
    .join("\n");
}

/** The text of one document's body, with a line for each block. */
function printed(xhtml: string): string {
  return xhtml
    .replace(/^[\s\S]*?<body\b[^>]*>/, "")
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
      if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(parseInt(name.slice(2), 16));
      if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
      return NAMED[name] ?? whole;
    });
}
