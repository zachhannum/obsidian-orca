import type { Locator } from "@playwright/test";
import { PREVIEW } from "../harness/book";
import { Export } from "../harness/export";
import { rowsIn } from "../harness/frames";
import { FLOATING } from "../harness/obsidian";
import type { Box } from "../harness/site";
import { expect, test } from "../harness/test";

/** The folder the sample book keeps its notes in, the book note, and the chapter after the plate. */
const FOLDER = "Twenty Thousand Leagues";
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const CHAPTER = "A Shifting Reef";
const EXPORTED = ["pdf", "epub"].map(
  (format) => `${FOLDER}/Twenty Thousand Leagues Under the Sea.${format}`,
);

/** The note that holds the plate, and the word of the image's name the take misspells. */
const PLATED = "A squid of colossal dimensions";
const PLATE = `${FOLDER}/${PLATED}.md`;
const RIGHT = "colossal";
const WRONG = "collosal";
const MISSING = `a-squid-of-${WRONG}-dimensions.jpg`;

/**
 * The folio the chapter's spread opens on, with the plate and without
 * it. The plate is the left page of that spread.
 */
const OPENS = 8;

/** The status bar's count of the note, which is one line. */
const COUNTED = "40 characters";

/** The navigator's width. */
const NAVIGATOR = 300;

/** The views and actions the take clicks, by the names Obsidian gives them. */
const EDITOR = "markdown";
const TITLE = "Twenty Thousand Leagues Under the Sea";
const EXPORT = "Export book";

/** The box of a word in a line of the editor, which is part of a text node and no element. */
async function wordIn(line: Locator, word: string): Promise<Box> {
  return line.evaluate((drawn, said) => {
    const texts = document.createTreeWalker(drawn, NodeFilter.SHOW_TEXT);
    for (let text = texts.nextNode(); text !== null; text = texts.nextNode()) {
      const at = (text.textContent ?? "").indexOf(said);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + said.length);
      const box = range.getBoundingClientRect();
      return {
        x: Math.round(box.left),
        y: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    }
    throw new Error(`the line has no ${said}`);
  }, word);
}

test("the export reel is preflight refusing a missing image, the fix, and the export", async ({
  reel,
}) => {
  const { site, vault } = reel;
  const { obsidian } = site;
  const exporting = new Export(obsidian);
  await reel.begin({ book: BOOK, chapter: CHAPTER, folio: OPENS });

  // One app runs every take of a shard, so the dialog is shut and the
  // sidebars go back when the take ends, however it ends.
  const left = await obsidian.collapsed("left");
  const right = await obsidian.collapsed("right");
  await site.navigator.reveal();
  const width = await obsidian.sidebar(NAVIGATOR, "left");
  try {
    await obsidian.put("right");
    const plate = await vault.read(PLATE);
    const misspelled = plate.replace(RIGHT, WRONG);
    expect(misspelled).toContain(MISSING);
    await vault.modify(PLATE, misspelled);
    // The export writes the book beside its note.
    for (const written of EXPORTED) vault.touch(written);

    // The book with its plate missing.
    await site.book.open();
    await expect(site.book.surface).toBeVisible();
    await reel.opensOn(CHAPTER, OPENS);
    await obsidian.put("right");
    const toExport = { export: obsidian.actionIn(PREVIEW, EXPORT) };
    await reel.frame("e0", toExport);

    // Preflight refuses it, and says where the fix is.
    await obsidian.actionIn(PREVIEW, EXPORT).click();
    await exporting.reaches("refused");
    await expect(exporting.errors).toHaveCount(1);
    await expect(exporting.errors).toContainText(`Missing image: ${MISSING}`);
    await expect(exporting.said).toHaveText("Fix 1 error to export");
    await expect(exporting.write).toBeDisabled();
    await reel.frame("e1", {
      fix: exporting.fixes,
      dialog: exporting.dialog,
      "export-off": exporting.write,
    });

    // The link shuts the dialog and opens the note on the line, in a
    // tab beside the preview's. The note is read as the text on disk:
    // the editor otherwise draws an image in place of the line that
    // names it, and the name set right would never show.
    await obsidian.asSource();
    await exporting.fixes.click();
    await expect(exporting.dialog).toHaveCount(0);
    const editor = obsidian.view(EDITOR);
    const line = editor.locator(".cm-line").first();
    await expect(line).toContainText(WRONG);
    // Obsidian marks the line it was sent to until the caret moves.
    await expect(line.locator(".is-flashing")).toHaveCount(1);
    // The status bar counts the note's words some time after it opens.
    await expect(obsidian.page.locator(FLOATING)).toContainText(COUNTED);
    const tab = obsidian.tab(TITLE);
    await expect(tab).toHaveCount(1);
    await reel.frame(
      "e2",
      {},
      {
        rows: await rowsIn(editor.locator(".cm-content")),
        measured: { word: await wordIn(line, WRONG) },
        paint: editor,
      },
    );

    // The author sets the name right.
    await obsidian.page.evaluate((wrong) => {
      const typed = window.app.workspace.activeEditor?.editor;
      if (typed === undefined) throw new Error("no editor in front");
      const at = typed.getLine(0).indexOf(wrong);
      typed.focus();
      typed.setSelection({ line: 0, ch: at }, { line: 0, ch: at + wrong.length });
    }, WRONG);
    await obsidian.page.keyboard.type(RIGHT);
    await expect(line).toContainText(RIGHT);
    await expect.poll(async () => vault.read(PLATE)).toEqual(plate);
    await reel.frame(
      "e3",
      { preview: tab },
      {
        rows: await rowsIn(editor.locator(".cm-content")),
        measured: { word: await wordIn(line, RIGHT) },
      },
    );

    // The book with its plate.
    await tab.click();
    await expect(site.book.surface).toBeVisible();
    // A session that set the plate out of its place opens it after the
    // colophon, and the chapter would still open on its folio.
    await reel.opensOn(PLATED, OPENS);
    await reel.opensOn(CHAPTER, OPENS);
    await obsidian.put("right");
    await reel.frame("e4", toExport);

    // Preflight passes it, and the export writes it.
    await obsidian.actionIn(PREVIEW, EXPORT).click();
    await exporting.reaches("ready");
    await expect(exporting.errors).toHaveCount(0);
    await expect(exporting.write).toBeEnabled();
    await reel.frame("e5", { write: exporting.write, dialog: exporting.dialog });
    await exporting.write.click();
    await exporting.reaches("written");
    await reel.frame("e6", { dialog: exporting.dialog, done: exporting.done });
    await exporting.close();
    await reel.end();
  } finally {
    await exporting.close();
    await obsidian.asRendered();
    await obsidian.sidebar(width, "left");
    if (left) await obsidian.put("left");
    if (!right) await obsidian.expand("right");
  }
});

// What this spec does not cover: whether the player shows each frame
// where its marks put it, which a look at the landing page answers; the
// frames on any platform but the one they were taken on; the bytes of
// the files the export wrote, which the export's own spec reads; the
// keys of the fix one at a time, because the take types the word
// between two frames; and the note in live preview, where the editor
// draws the image in place of the line.
