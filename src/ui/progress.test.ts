import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookFile } from "@/ui/frame";
import { chapters, percent, status, statusText } from "@/ui/progress";

const file = (path: string, mediaType: string, text: string): BookFile => ({
  path,
  mediaType,
  bytes: new TextEncoder().encode(text),
});

const XHTML = "application/xhtml+xml";

/** A package that lists `nav` or `ncx` beside three documents. */
function opf(extra: string): BookFile {
  return file(
    "EPUB/package.opf",
    "application/oebps-package+xml",
    `<package><manifest>${extra}
<item id="a" href="cover.xhtml" media-type="${XHTML}"/>
<item id="b" href="text/one.xhtml" media-type="${XHTML}"/>
<item id="c" href="text/two.xhtml" media-type="${XHTML}"/>
</manifest></package>`,
  );
}

const documents = [
  file("EPUB/cover.xhtml", XHTML, "x".repeat(100)),
  file("EPUB/text/one.xhtml", XHTML, "x".repeat(300)),
  file("EPUB/text/two.xhtml", XHTML, "x".repeat(600)),
];
const spine = documents.map((each, at) => ({ path: each.path, section: at + 1 }));

test("a document takes the title of the first nav entry that points at it, and one with no entry takes none", () => {
  const nav = file(
    "EPUB/nav.xhtml",
    XHTML,
    `<html><body>
<nav epub:type="landmarks"><ol><li><a href="cover.xhtml">Cover</a></li></ol></nav>
<nav epub:type="toc" id="toc"><ol>
<li><a href="text/one.xhtml#n2">Chapter <em>One</em></a></li>
<li><a href="text/one.xhtml#n9">A second entry</a></li>
<li><a href="text/two.xhtml">Pride &amp; Prejudice</a></li>
</ol></nav></body></html>`,
  );
  const book = {
    spine,
    files: [opf(`<item id="nav" href="nav.xhtml" properties="nav" media-type="${XHTML}"/>`), nav, ...documents],
  };
  assert.deepEqual(chapters(book), [
    { title: undefined, length: 100 },
    { title: "Chapter One", length: 300 },
    { title: "Pride & Prejudice", length: 600 },
  ]);
});

test("a book with no nav document reads its titles from toc.ncx", () => {
  const ncx = file(
    "EPUB/toc.ncx",
    "application/x-dtbncx+xml",
    `<ncx><navMap>
<navPoint id="p1"><navLabel><text>One</text></navLabel><content src="text/one.xhtml#a"/>
<navPoint id="p2"><navLabel><text>Inside one</text></navLabel><content src="text/one.xhtml#b"/></navPoint>
</navPoint>
<navPoint id="p3"><navLabel><text>Two</text></navLabel><content src="text/two.xhtml"/></navPoint>
</navMap></ncx>`,
  );
  const book = {
    spine,
    files: [opf(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`), ncx, ...documents],
  };
  assert.deepEqual(
    chapters(book).map((each) => each.title),
    [undefined, "One", "Two"],
  );
});

test("a spine path with no file is skipped, as the view binds none for it", () => {
  const book = { spine: [{ path: "EPUB/missing.xhtml", section: 9 }, ...spine], files: documents };
  assert.equal(chapters(book).length, 3);
});

test("the percentage weights each document by its length and rounds down", () => {
  const lengths = [100, 300, 600];
  assert.equal(percent(lengths, 0, 1, 1), 0);
  // 100 before, and a third of 300 into the second.
  assert.equal(percent(lengths, 1, 2, 3), 20);
  // 400 before, and 600 × 3 / 5 into the third: 760 of 1000.
  assert.equal(percent(lengths, 2, 4, 5), 76);
  assert.equal(percent(lengths, 2, 5, 5), 100);
  assert.equal(percent([1, 1000], 1, 1, 1), 100);
});

test("only the last page of the last document reads 100%", () => {
  // 999 of 1000 rounds down, so the reader is not told the book is over.
  assert.equal(percent([999, 1], 1, 1, 2), 99);
  assert.equal(percent([999, 1], 0, 5, 5), 79);
  assert.equal(percent([10], 0, 2, 2), 100);
});

test("the status line names the chapter, the page in it and the percentage, and leaves out a title it has not got", () => {
  const read = [
    { title: undefined, length: 100 },
    { title: "Chapter Twelve", length: 900 },
  ];
  assert.equal(statusText(status(read, 1, 3, 14)), "Chapter Twelve · page 3 of 14 · 22%");
  assert.equal(statusText(status(read, 0, 1, 1)), "page 1 of 1 · 0%");
});

// What this tier does not cover: a table of contents written by
// anything but the engine and the shapes above, such as one whose
// entries nest a link inside a span, and the status line drawn in the
// view, which the e2e suite reads.
