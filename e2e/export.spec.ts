import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { countWords } from "@/book/words";
import { expect, test } from "./harness/test";

/** The file export names from the book's title, beside the book note at the top of the vault. */
const FILE = "Pride and Prejudice.pdf";

/** The pages the fixture book sets to. */
const PAGES = 15;

/** The words in every note the fixture book reads. */
const BOOK_WORDS = 736;

/**
 * The words the pages print that no note holds: the title page, the
 * contents, a running head and a folio on most pages. They are a few
 * words a page, so the bound is a little more than that for fifteen.
 */
const PRINTED_WORDS = 160;

/** The note that embeds the fixture's one image. */
const EMBEDS = "Acknowledgements.md";

test("export writes the pages on screen to a vault path, and the file is a PDF with the book's words", async ({
  book,
  exporting,
  vault,
}) => {
  await book.open();
  const generation = await book.painted();
  const stages = await book.stages();
  // The export writes a file the checked-in vault does not have, and
  // the vault takes it back out when the spec ends.
  vault.touch(FILE);

  await exporting.open();
  await exporting.reaches("ready");
  await expect(exporting.destination).toHaveValue(FILE);
  await expect(exporting.fine).toHaveText("Every face embeds. Every image resolves.");

  await exporting.write.click();
  await exporting.reaches("written");
  await expect(exporting.dialog).toHaveAttribute("data-leaves", String(PAGES));

  const bytes = await vault.bytes(FILE);
  await expect(exporting.dialog).toHaveAttribute("data-bytes", String(bytes.length));
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

test("the dialog offers a path on disk through the OS", async ({ book, exporting }) => {
  await book.open();
  await book.painted();

  await exporting.open();
  await exporting.reaches("ready");
  await expect(exporting.choose).toBeEnabled();
  // A native save dialog cannot be answered over CDP, so the OS-path
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
  await expect(exporting.errors).toContainText("The vault has no nowhere.png.");
  await expect(exporting.errors).toContainText(`embedded in Acknowledgements, line ${String(line)}`);
  await expect(exporting.said).toHaveText(
    "One error stands. Export will not write while it does.",
  );
  await expect(exporting.write).toBeDisabled();
});

// What this suite does not cover: the write to a path on disk, which
// stops at the native dialog; a face that would not embed, since every
// face the fixture uses ships in the vault; and a failed write, which
// the Node tier's sink tests reach.
