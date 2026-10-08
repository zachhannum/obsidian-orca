import { Export } from "../harness/export";
import { expect, test } from "../harness/test";

/**
 * The folder the sample book keeps its notes in, the book note, the
 * page the take starts on and the chapter it taps.
 */
const FOLDER = "Twenty Thousand Leagues";
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const START = "Title page";
const CHAPTER = "A Shifting Reef";
const EXPORTED = ["pdf", "epub"].map(
  (format) => `${FOLDER}/Twenty Thousand Leagues Under the Sea.${format}`,
);

/**
 * The folio each of the two opens on, in the sample book and in the
 * book the take starts from.
 */
const OPENS = 1;
const TURNS = 9;

/** The book the take starts from: the text flush left, which one tap in the panel justifies. */
const ALIGN = "body-align";
const SET = `${ALIGN}: justify`;
const RAGGED = `${ALIGN}: left`;

test("the tablet's frames are Obsidian's tablet layout on the sample book", async ({ reel }) => {
  const { site, vault } = reel;
  const { obsidian, book, panel, navigator } = site;
  await reel.begin({ book: BOOK, chapter: START, folio: OPENS, device: "tablet" });
  const sample = await vault.read(BOOK);
  expect(sample).toContain(SET);
  await vault.modify(BOOK, sample.replace(SET, RAGGED));
  // For a moment after the write the note parses as no book, and the
  // command that opens the book opens nothing.
  await reel.indexed(BOOK, ALIGN, "left");
  await obsidian.open(BOOK);
  await book.open();
  await expect(book.surface).toBeVisible();
  // The panel writes the book note and the export writes the book.
  for (const written of EXPORTED) vault.touch(written);

  // A tablet pins both drawers, so the navigator and the design panel
  // stand beside the page. The panel draws nothing until a book is open.
  await navigator.reveal();
  await expect(navigator.book(BOOK)).toHaveCount(1);
  await obsidian.pin(true, "left");
  await panel.open();
  await obsidian.pin(true, "right");
  await reel.opensOn(START, OPENS);
  // Between two pinned drawers the pane is as narrow as a phone's.
  await book.footed("under");

  // The alignment is further down the panel, so the panel is scrolled
  // to it before the first frame is taken.
  const chapter = navigator.entry(BOOK, CHAPTER);
  const justify = panel.choice("body-align", "justify");
  await expect(chapter).toBeInViewport({ ratio: 1 });
  await panel.scrollTo(justify);
  await expect(justify).toHaveAttribute("aria-pressed", "false");
  const drawn = {
    navigator: obsidian.drawer("left"),
    panel: obsidian.drawer("right"),
    chapter,
    justify,
    export: book.exportIn,
  };
  await reel.frame("pinned", drawn);

  // A tap on a chapter turns the preview to it.
  const listed = await chapter.boundingBox();
  await chapter.locator(".orca-label").click();
  await expect(book.chapterName).toHaveText(CHAPTER);
  await reel.settled();
  await expect(book.surface).toHaveAttribute("data-first", String(TURNS));
  // The player holds the navigator still, so the tap must not scroll it.
  expect(await chapter.boundingBox()).toEqual(listed);
  await reel.frame("turned", drawn);

  // One tap justifies the text, and the page beside the panel is set again.
  const before = await book.painted();
  await justify.click();
  await expect(justify).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => book.painted()).toBeGreaterThan(before);
  await reel.settled();
  await reel.frame("justified", drawn);

  // Export, from the action in the preview's own bar.
  const exporting = new Export(obsidian);
  // A real device can share a file, so its dialog has Share. The
  // emulation cannot, so the take stands in for the share sheet.
  await exporting.sharing();
  await book.exportIn.click();
  await exporting.reaches("ready");
  await expect(exporting.share).toBeEnabled();
  await reel.frame("dialog", { dialog: exporting.dialog, write: exporting.write, share: exporting.share });
  await exporting.write.click();
  await exporting.reaches("written");
  await reel.frame("written", { dialog: exporting.dialog, done: exporting.done });
  await exporting.close();

  await reel.end();
});

// What this spec does not cover: the menu a select opens on a tablet.
// The menu is the platform's own and no picture holds it, so the take
// changes the book with a control that takes one tap. The layout is the
// desktop app's emulation of a tablet, so no frame is from a real one,
// and none is of a tablet held upright. The export specs read the files
// the export writes, and this one does not.
