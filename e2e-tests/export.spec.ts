import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { epubText } from "@/book/testUtils/epub";
import { countWords } from "@/book/words";
import { CHECK } from "./harness/report";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. It sits at the top of the vault. */
const BOOK = "Pride and Prejudice.md";

/** The name export gives the files from the book's title, beside the book note. */
const NAME = "Pride and Prejudice";

/** The PDF export writes. */
const FILE = `${NAME}.pdf`;

/** The EPUB export writes. */
const EPUB = `${NAME}.epub`;

/** The words in every note the fixture book reads. */
const BOOK_WORDS = 958;

/**
 * The words the pages print that no note holds: the title page, the
 * contents, a running head and a folio on most pages. They are a few
 * words a page, so the bound is a little more than that for fifteen.
 */
const PRINTED_WORDS = 160;

/** The part of epubcheck's JSON report the spec reads. */
interface Epubcheck {
  messages: { ID: string; severity: string; message: string }[];
  checker: { checkerVersion: string; nFatal: number; nError: number; nWarning: number };
}

/** A folio, or a span of them. */
const FOLIO = /^\d+(–\d+)?$/;

/** The note an embed that will not read is written into. */
const EMBEDS = "Acknowledgements.md";

/** More errors than a dialog has room for on any screen. */
const MANY = 24;

/** One embed with no file behind it for each of those errors. */
const MANY_EMBEDS = Array.from(
  { length: MANY },
  (_, at) => `![[nowhere-${String(at)}.png]]`,
).join("\n\n");

/** The count of notes the fixture book reads that embed an image. */
const EMBEDDED = 2;

/**
 * A rule that puts the fixture's image behind every page, once. The url
 * is bare, so the editor closes no quote the spec types.
 */
const BACKGROUND =
  "@page { background-image: url(images/device.png); background-repeat: no-repeat; }";

test("export writes the pages on screen to a vault path, and the file is a PDF with the book's words", async ({
  book,
  exporting,
  vault,
}) => {
  await book.open();
  // An earlier spec's restore can leave a render on its way, so the
  // stages are recorded once the book has painted everything queued.
  const generation = await book.settled(BOOK);
  const stages = await book.stages();
  // An earlier spec may leave the book a different length, so the pages
  // expected are the ones the preview counts.
  await expect(book.status).toHaveText(/ of \d+$/);
  const pages = /of (\d+)$/.exec((await book.status.textContent()) ?? "")?.[1];
  // The export writes a file the checked-in vault does not have, and
  // the vault takes it back out when the spec ends.
  vault.touch(FILE);

  await exporting.open();
  await exporting.reaches("ready");
  await expect(exporting.destination).toHaveValue(NAME);
  await expect(exporting.fine).toHaveText("No errors");
  await exporting.formats("pdf");

  await exporting.write.click();
  await exporting.reaches("written");
  await expect(exporting.files).toHaveCount(1);
  await expect(exporting.file("pdf")).toHaveAttribute("data-leaves", pages ?? "");

  const bytes = await vault.bytes(FILE);
  await expect(exporting.file("pdf")).toHaveAttribute("data-bytes", String(bytes.length));
  const folder = await mkdtemp(path.join(tmpdir(), "orca-export-"));
  try {
    const written = path.join(folder, FILE);
    await writeFile(written, bytes);
    const checked = spawnSync("qpdf", ["--check", written], { encoding: "utf8" });
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);

    // A word the engine hyphenated comes back in two pieces, so a break
    // after a hyphen at the end of a line is joined before the count.
    const text = execFileSync("pdftotext", [written, "-"], { encoding: "utf8" });
    const words = countWords(text.replace(/-\n/g, ""));
    expect(words).toBeGreaterThanOrEqual(BOOK_WORDS);
    expect(words).toBeLessThanOrEqual(BOOK_WORDS + PRINTED_WORDS);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }

  // The file came off the session the preview reads, so the book was
  // not laid out again.
  expect(await book.stages()).toEqual(stages);
  await expect(book.surface).toHaveAttribute("data-generation", String(generation));
});

test("epubcheck reports no errors on the exported EPUB, and the EPUB holds the words the PDF holds", async ({
  book,
  exporting,
  vault,
}, info) => {
  await book.open();
  await book.settled(BOOK);
  // The export writes two files the checked-in vault does not have,
  // and the vault takes them back out when the spec ends.
  vault.touch(FILE);
  vault.touch(EPUB);

  await exporting.open();
  await exporting.reaches("ready");
  await exporting.formats("pdf", "epub");
  await exporting.write.click();
  await exporting.reaches("written");

  const epub = await vault.bytes(EPUB);
  const folder = await mkdtemp(path.join(tmpdir(), "orca-export-"));
  try {
    const written = path.join(folder, EPUB);
    await writeFile(written, epub);
    // epubcheck writes its report to stdout as JSON, and what it says
    // on the way to stderr.
    const ran = spawnSync("epubcheck", [written, "--json", "-"], { encoding: "utf8" });
    expect(ran.error, "epubcheck is not on the PATH").toBeUndefined();
    const report = JSON.parse(ran.stdout) as Epubcheck;
    const { checkerVersion, nFatal, nError, nWarning } = report.checker;
    info.annotations.push({
      type: CHECK,
      description: `epubcheck ${checkerVersion} on ${EPUB}: ${String(nFatal + nError)} errors, ${String(nWarning)} warnings`,
    });
    const errors = report.messages.filter(({ severity }) => severity === "FATAL" || severity === "ERROR");
    expect(errors.map(({ ID, message }) => `${ID} ${message}`)).toEqual([]);
    expect(nFatal + nError).toBe(0);
    expect(ran.status, ran.stderr).toBe(0);

    const pdf = path.join(folder, FILE);
    await writeFile(pdf, await vault.bytes(FILE));
    // A word the engine hyphenated comes back in two pieces, so a break
    // after a hyphen at the end of a line is joined before the count.
    const paged = countWords(execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" }).replace(/-\n/g, ""));
    // An EPUB has no pages, so it prints the title page and the
    // contents and no running head or folio.
    const flowed = countWords(epubText(epub));
    expect(flowed).toBeGreaterThanOrEqual(BOOK_WORDS);
    expect(flowed).toBeLessThanOrEqual(paged);
    expect(paged).toBeLessThanOrEqual(BOOK_WORDS + PRINTED_WORDS);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("export writes the book as an EPUB from the open session, and its warnings join the list unchanged", async ({
  book,
  exporting,
  vault,
}) => {
  await book.open();
  const generation = await book.settled(BOOK);
  const stages = await book.stages();
  const before = await book.issues.allTextContents();
  vault.touch(EPUB);

  await exporting.open();
  await exporting.reaches("ready");
  await exporting.formats("epub");
  await exporting.write.click();
  await exporting.reaches("written");
  // An EPUB has no pages of its own, so the result counts none.
  await expect(exporting.files).toHaveCount(1);
  await expect(exporting.file("epub")).not.toHaveAttribute("data-leaves");
  await expect(exporting.openPdf).toHaveCount(0);

  const bytes = await vault.bytes(EPUB);
  await expect(exporting.file("epub")).toHaveAttribute("data-bytes", String(bytes.length));
  // A zip opens on a local file header, and an EPUB's first file is its mimetype.
  expect([...bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  expect(new TextDecoder().decode(bytes.subarray(30, 58))).toMatch(/^mimetypeapplication\/epub\+zip/);

  // The EPUB came off the session the preview reads, and runs no
  // layout stage.
  expect(await book.stages()).toEqual(stages);
  await expect(book.surface).toHaveAttribute("data-generation", String(generation));

  // The run's warnings still stand, and the panel's page rules add none.
  const after = await book.issues.allTextContents();
  for (const said of before) expect(after).toContain(said);
  for (const said of after) expect(said).not.toMatch(/@page|page rule|margin box/i);
  await exporting.close();
});

test("one export writes every format ticked, each beside the others under the book's name", async ({
  book,
  exporting,
  vault,
}) => {
  await book.open();
  const generation = await book.settled(BOOK);
  const stages = await book.stages();
  vault.touch(FILE);
  vault.touch(EPUB);

  await exporting.open();
  await exporting.reaches("ready");
  // Every format is ticked when the dialog opens.
  await expect(exporting.dialog).toHaveAttribute("data-formats", "pdf epub");
  await expect(exporting.dialog.getByTestId("orca-export-files")).toHaveText(`${FILE}, ${EPUB}`);
  await exporting.write.click();
  await exporting.reaches("written");

  await expect(exporting.files).toHaveCount(2);
  await expect(exporting.file("pdf")).toHaveAttribute("data-bytes", String((await vault.bytes(FILE)).length));
  await expect(exporting.file("epub")).toHaveAttribute("data-bytes", String((await vault.bytes(EPUB)).length));
  await expect(exporting.openPdf).toHaveCount(1);
  expect(await book.stages()).toEqual(stages);
  await expect(book.surface).toHaveAttribute("data-generation", String(generation));
  await exporting.close();
});

test("with no format ticked, export will not write", async ({ book, exporting }) => {
  await book.open();
  await book.painted();

  await exporting.open();
  await exporting.reaches("ready");
  await exporting.formats();
  await expect(exporting.write).toBeDisabled();
  await expect(exporting.said).toHaveText("Pick a format to export");
});

test("the dialog offers a path on disk through the OS", async ({ book, exporting }) => {
  await book.open();
  await book.painted();

  await exporting.open();
  await exporting.reaches("ready");
  await expect(exporting.choose).toBeEnabled();
  // A native folder dialog cannot be answered over CDP, so the OS-path
  // branch stops here. The sink it writes through is tested in the Node
  // tier.
});

test("an embed with no file behind it stands as an error, and export will not write", async ({
  book,
  exporting,
  vault,
}) => {
  await book.open();
  await book.painted();
  const text = await vault.read(EMBEDS);
  const written = `${text.trimEnd()}\n\n![[nowhere.png]]\n`;
  const line = written.split("\n").indexOf("![[nowhere.png]]") + 1;
  await vault.modify(EMBEDS, written);

  await exporting.open();
  await exporting.reaches("refused");
  await expect(exporting.dialog).toHaveAttribute("data-errors", "1");
  await expect(exporting.errors).toHaveCount(1);
  await expect(exporting.errors).toContainText("Missing image: nowhere.png");
  await expect(exporting.errors).toContainText(`Acknowledgements, line ${String(line)}`);
  await expect(exporting.said).toHaveText("Fix 1 error to export");
  await expect(exporting.write).toBeDisabled();

  // The note goes back before the spec ends, and the render that puts
  // the book back lands here rather than under the next spec.
  await exporting.close();
  await vault.restore();
  await book.settled(BOOK);
});

test("with more errors than the dialog has room for, the list scrolls and Export and Cancel stay on the screen", async ({
  book,
  exporting,
  vault,
}) => {
  await book.open();
  await book.painted();
  const text = await vault.read(EMBEDS);
  await vault.modify(EMBEDS, `${text.trimEnd()}\n\n${MANY_EMBEDS}\n`);

  await exporting.open();
  await exporting.reaches("refused");
  await expect(exporting.dialog).toHaveAttribute("data-errors", String(MANY));
  await expect(exporting.errors).toHaveCount(MANY);

  const scrolled = await exporting.scrolled();
  expect(scrolled.hidden).toBeGreaterThan(0);
  expect(scrolled.spill).toBeLessThanOrEqual(0);
  expect(scrolled.moved).toBe(0);
  expect(scrolled.formats).toBe(true);
  expect(scrolled.buttons).toBe(true);
  expect(scrolled.last).toBe(true);

  await exporting.close();
  await vault.restore();
  await book.settled(BOOK);
});

test("an image the book's CSS names is painted behind the pages, and the PDF carries it", async ({
  book,
  exporting,
  note,
  panel,
  vault,
}) => {
  vault.touch(BOOK);
  vault.touch(FILE);
  await book.open();
  const before = await book.settled(BOOK);
  await panel.open();
  await panel.toCss.click();
  await expect(panel.editor).toBeVisible();

  await panel.typeCss(`\n${BACKGROUND}`);
  await expect.poll(async () => book.painted()).toBeGreaterThan(before);
  await book.settled(BOOK);
  // The book note page reads its folios off the same session, and the
  // pages and the PDF still carry the image the book's CSS names.
  await note.beside(BOOK);
  await expect(note.pages("Copyright")).toHaveText(FOLIO);

  // The title page embeds nothing, so the image on it is the background.
  await book.type("1");
  await expect(book.surface).toHaveAttribute("data-first", "1");
  await expect(book.page.locator("image")).toHaveCount(1);
  await expect(book.page.locator("image")).toHaveAttribute("href", /^blob:/);
  await expect(book.count).toBeHidden();
  await expect(book.status).toHaveText(/ of \d+$/);
  const pages = Number(/of (\d+)$/.exec((await book.status.textContent()) ?? "")?.[1]);

  await exporting.open();
  await exporting.reaches("ready");
  await exporting.formats("pdf");
  await exporting.write.click();
  await exporting.reaches("written");

  const folder = await mkdtemp(path.join(tmpdir(), "orca-export-"));
  try {
    const written = path.join(folder, FILE);
    await writeFile(written, await vault.bytes(FILE));
    // Two heading lines, then one line for each image a page draws: the
    // background on every page, and the embed each of the two notes
    // that carry one draws.
    const listed = execFileSync("pdfimages", ["-list", written], { encoding: "utf8" });
    const drawn = listed.trim().split("\n").slice(2);
    expect(drawn.length).toBe(pages + EMBEDDED);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }

  await exporting.close();
  await note.close();
  await vault.restore();
  await book.settled(BOOK);
});

test("a cover that names no image in the vault shows in the Issues list once the EPUB is written", async ({
  book,
  exporting,
  note,
  vault,
}) => {
  const SAID = "Cover image nowhere.png did not load. It is left out of the EPUB.";
  vault.touch(BOOK);
  vault.touch(EPUB);
  await note.open(BOOK);
  // The page offers only images the vault has, so the name goes in as an edit to the book.
  await note.covered("nowhere.png");
  await expect.poll(async () => vault.read(BOOK)).toContain("cover: nowhere.png");
  await expect(note.missing).toHaveText("Not in the vault");

  await book.open();
  await book.settled(BOOK);
  // The cover belongs to the EPUB, so the pages say nothing about it.
  expect(await book.issues.allTextContents()).not.toContain(SAID);

  await exporting.open();
  await exporting.reaches("ready");
  await exporting.formats("epub");
  await exporting.write.click();
  await exporting.reaches("written");
  await exporting.close();

  await expect(book.issues.filter({ hasText: SAID })).toHaveCount(1);
});

// What this suite does not cover: the write to a path on disk, which
// stops at the native dialog; a face that would not embed, since every
// face the fixture uses ships in the vault; and a failed write, which
// the Node tier's sink tests reach. The list of errors holds no
// warning yet, so a warning in it is not covered either.
