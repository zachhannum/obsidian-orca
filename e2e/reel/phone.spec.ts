import { Export } from "../harness/export";
import { expect, test } from "../harness/test";

/** The folder the sample book keeps its notes in, the book note, and the chapter the take reads. */
const FOLDER = "Twenty Thousand Leagues";
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const CHAPTER = "A Shifting Reef";
const EXPORTED = ["pdf", "epub"].map(
  (format) => `${FOLDER}/Twenty Thousand Leagues Under the Sea.${format}`,
);

/** The folio the chapter's first page has, in the sample book and in the book the take starts from. */
const OPENS = 9;

/** The book the take starts from: the text flush left, which one tap in the panel justifies. */
const ALIGN = "body-align";
const SET = `${ALIGN}: justify`;
const RAGGED = `${ALIGN}: left`;

test("the phone's frames are Obsidian's phone layout on the sample book", async ({ reel }) => {
  const { site, vault } = reel;
  const { obsidian, book, panel } = site;
  await reel.begin({ book: BOOK, chapter: CHAPTER, folio: OPENS, device: "phone" });
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

  // The preview alone: a phone shows one pane, and one page in it.
  await reel.opensOn(CHAPTER, OPENS);
  await book.footed("under");
  await book.uncovered();
  await reel.frame("page", { export: book.exportIn });

  // The design panel is the right drawer, which a swipe from the edge
  // brings in over the page.
  await panel.open();
  await expect(panel.panel).toBeVisible();
  const justify = panel.choice("body-align", "justify");
  await panel.scrollTo(justify);
  await reel.settled();
  await expect(justify).toHaveAttribute("aria-pressed", "false");
  const drawn = { drawer: obsidian.drawer("right"), justify, scroller: panel.scroller };
  await reel.frame("drawer", drawn, { scroll: panel.scroller });

  // One tap justifies the text, and the pages are set under the drawer.
  const before = await book.painted();
  await justify.click();
  await expect(justify).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => book.painted()).toBeGreaterThan(before);
  await reel.settled();
  await reel.frame("justified", drawn, { scroll: panel.scroller });

  // The drawer goes, and the page under it is the book as it is now set.
  await book.uncovered();
  await reel.frame("set", { export: book.exportIn });

  // Export is a sheet that rises from the foot of the screen.
  const exporting = new Export(obsidian);
  await book.exportIn.click();
  await exporting.reaches("ready");
  await reel.frame("sheet", { sheet: exporting.dialog, write: exporting.write });
  await exporting.write.click();
  await exporting.reaches("written");
  await reel.frame("written", { sheet: exporting.dialog, done: exporting.done });
  await exporting.close();

  await reel.end();
});

// What this spec does not cover: the swipe that brings the drawer in.
// The take opens the drawer with its command, and the player draws the
// finger. The player also makes the slide of the drawer and of the
// sheet, from the frames either side. The layout is the desktop app's
// emulation of a phone, so no frame is from a real one. The export
// specs read the files the export writes, and this one does not.
