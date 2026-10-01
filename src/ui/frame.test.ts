import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindFiles,
  fitted,
  resolvePath,
  rewriteSheet,
  sheetOrder,
  stepOf,
  turnedBy,
  type BookFile,
  type Links,
} from "@/ui/frame";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test("a reference resolves against the folder of the file that makes it", () => {
  assert.equal(resolvePath("EPUB/section-001.xhtml", "book.css"), "EPUB/book.css");
  assert.equal(resolvePath("EPUB/section-001.xhtml", "media/image-1.png"), "EPUB/media/image-1.png");
  assert.equal(resolvePath("EPUB/styles/book.css", "../fonts/a.otf"), "EPUB/fonts/a.otf");
  assert.equal(resolvePath("EPUB/styles/book.css", "./../../cover.png"), "cover.png");
  assert.equal(resolvePath("EPUB/section-001.xhtml", "section-002.xhtml#n14"), "EPUB/section-002.xhtml");
  assert.equal(resolvePath("EPUB/book.css", "fonts/A%20B.otf?v=1"), "EPUB/fonts/A B.otf");
  assert.equal(resolvePath("EPUB/book.css", "/fonts/a.otf"), "fonts/a.otf");
});

test("a reference that leaves the book, or stays in the file, resolves to nothing", () => {
  assert.equal(resolvePath("EPUB/section-001.xhtml", "https://example.com/a.png"), undefined);
  assert.equal(resolvePath("EPUB/section-001.xhtml", "data:image/png;base64,AAAA"), undefined);
  assert.equal(resolvePath("EPUB/section-001.xhtml", "//example.com/a.png"), undefined);
  assert.equal(resolvePath("EPUB/section-001.xhtml", "#n14"), undefined);
  assert.equal(resolvePath("EPUB/section-001.xhtml", ""), undefined);
});

test("a sheet's url() calls go to the URLs of the files they name", () => {
  const urls = new Map([
    ["EPUB/fonts/a.otf", "blob:a"],
    ["EPUB/media/image-1.png", "blob:image"],
  ]);
  const css = [
    '@font-face { src: url("../fonts/a.otf") format("opentype"); }',
    "body { background: url( 'media/image-1.png' ); }",
    "h1 { background: url(../media/image-1.png); }",
    "p { background: url(data:image/png;base64,AAAA); }",
    'q { background: url("missing.png"); }',
  ].join("\n");
  assert.equal(
    rewriteSheet("EPUB/styles/book.css", css, (path) => urls.get(path)),
    [
      '@font-face { src: url("blob:a") format("opentype"); }',
      "body { background: url( 'media/image-1.png' ); }",
      'h1 { background: url("blob:image"); }',
      "p { background: url(data:image/png;base64,AAAA); }",
      'q { background: url("missing.png"); }',
    ].join("\n"),
  );
  assert.equal(
    rewriteSheet("EPUB/book.css", "body { background: url( 'media/image-1.png' ); }", (path) =>
      urls.get(path),
    ),
    'body { background: url("blob:image"); }',
  );
});

test("a document with a stylesheet takes ReadiumCSS before and after it, and one without takes the default between", () => {
  assert.deepEqual(sheetOrder(true), ["before", "after"]);
  assert.deepEqual(sheetOrder(false), ["before", "default", "after"]);
});

test("a turn stays in the section while it has a screen that way", () => {
  assert.deepEqual(turnedBy({ section: 2, screen: 0 }, 1, 3, 5), { section: 2, screen: 1 });
  assert.deepEqual(turnedBy({ section: 2, screen: 2 }, -1, 3, 5), { section: 2, screen: 1 });
});

test("a turn past the last screen opens the next section at its first, and one before the first opens the previous at its last", () => {
  assert.deepEqual(turnedBy({ section: 2, screen: 2 }, 1, 3, 5), { section: 3, screen: 0 });
  assert.deepEqual(turnedBy({ section: 2, screen: 0 }, -1, 3, 5), { section: 1, screen: "last" });
});

test("a turn off either end of the book goes nowhere", () => {
  assert.equal(turnedBy({ section: 0, screen: 0 }, -1, 3, 5), undefined);
  assert.equal(turnedBy({ section: 4, screen: 2 }, 1, 3, 5), undefined);
});

test("the arrow and page keys turn a screen, and no other key does", () => {
  assert.equal(stepOf("ArrowRight"), 1);
  assert.equal(stepOf("PageDown"), 1);
  assert.equal(stepOf("ArrowLeft"), -1);
  assert.equal(stepOf("PageUp"), -1);
  assert.equal(stepOf("a"), undefined);
});

test("a screen larger than the well scales down to fit it, and a smaller one is not enlarged", () => {
  assert.equal(fitted({ width: 600, height: 800 }, { width: 600, height: 400 }), 0.5);
  assert.equal(fitted({ width: 600, height: 800 }, { width: 150, height: 800 }), 0.25);
  assert.equal(fitted({ width: 390, height: 844 }, { width: 2000, height: 2000 }), 1);
  assert.equal(fitted({ width: 390, height: 844 }, { width: 0, height: 0 }), 1);
});

/** A book of two documents, a sheet, a font and an image, bound with counted URLs. */
function bound(): {
  made: { url: string; body: Uint8Array | string; mediaType: string }[];
  live: Set<string>;
  seen: { path: string; links: Links }[];
  result: ReturnType<typeof bindFiles>;
} {
  const files: BookFile[] = [
    { path: "EPUB/section-001.xhtml", mediaType: "application/xhtml+xml", bytes: bytes("<one/>") },
    { path: "EPUB/book.css", mediaType: "text/css", bytes: bytes("a { src: url(fonts/a.otf) }") },
    { path: "EPUB/nav.xhtml", mediaType: "application/xhtml+xml", bytes: bytes("<nav/>") },
    { path: "EPUB/section-002.xhtml", mediaType: "application/xhtml+xml", bytes: bytes("<two/>") },
    { path: "EPUB/fonts/a.otf", mediaType: "font/otf", bytes: bytes("font") },
    { path: "EPUB/media/image-1.png", mediaType: "image/png", bytes: bytes("png") },
  ];
  const made: { url: string; body: Uint8Array | string; mediaType: string }[] = [];
  const live = new Set<string>();
  const seen: { path: string; links: Links }[] = [];
  const result = bindFiles(
    { spine: ["EPUB/section-001.xhtml", "EPUB/section-002.xhtml"], files },
    { before: "/* before */", fallback: "/* default */", after: "/* after */" },
    (body, mediaType) => {
      const url = `blob:${String(made.length)}`;
      made.push({ url, body, mediaType });
      live.add(url);
      return url;
    },
    (url) => {
      assert.ok(live.delete(url), `${url} was released twice`);
    },
    (path, xhtml, links) => {
      seen.push({ path, links });
      return `${xhtml}<!-- ${links.sheet("EPUB/book.css") ?? "none"} -->`;
    },
  );
  return { made, live, seen, result };
}

test("images and fonts are bound before the sheets and documents that name them, and the spine's documents come back in reading order", () => {
  const { made, seen, result } = bound();
  assert.deepEqual(
    made.map((each) => each.mediaType),
    ["font/otf", "image/png", "application/xhtml+xml", "application/xhtml+xml"],
  );
  assert.deepEqual(
    seen.map((each) => each.path),
    ["EPUB/section-001.xhtml", "EPUB/section-002.xhtml"],
  );
  assert.deepEqual(seen[0]?.links.sheets, {
    before: "/* before */",
    fallback: "/* default */",
    after: "/* after */",
  });
  // A sheet reaches a document as text, and makes no URL of its own.
  assert.equal(seen[0]?.links.sheet("EPUB/book.css"), 'a { src: url("blob:0") }');
  assert.equal(seen[0]?.links.sheet("EPUB/missing.css"), undefined);
  assert.equal(seen[0]?.links.url("EPUB/media/image-1.png"), "blob:1");
  assert.equal(seen[0]?.links.url("EPUB/missing.png"), undefined);
  assert.deepEqual(result.documents, ["blob:2", "blob:3"]);
  assert.equal(made[2]?.body, '<one/><!-- a { src: url("blob:0") } -->');
});

test("revoke releases every URL that was made", () => {
  const { made, live, result } = bound();
  assert.equal(live.size, made.length);
  result.revoke();
  assert.equal(live.size, 0);
  // A second call has nothing left to release.
  result.revoke();
});

// What this tier does not cover: `rewriteDocument`, which parses a
// document and needs a browser, and a frame loading what is bound. The
// e2e suite reads both off the frame. A sheet's `@import` of another
// sheet is not rewritten, and the engine writes none.
