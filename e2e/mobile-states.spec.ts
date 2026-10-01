import { PREVIEW_CONTROLS } from "./harness/book";
import { TOUCH } from "./harness/obsidian";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** A book that lists no notes, and the chapter its button makes. */
const EMPTY = "Empty book.md";
const NEW_CHAPTER = "New chapter.md";

/** The widest a phone draws a state's button, which is the column's width there. */
const COLUMN = 320;

/** The widest a tablet draws a notice over the pages. */
const NOTICE = 440;

/** The dialog's two buttons, in the order the mobile artboards stack them. */
const CHOICES = ["Keep my changes", "Use the saved version"];

for (const device of ["phone", "tablet"] as const) {
  test(`on a ${device} a book with no pages offers a chapter from a button the size of a touch`, async ({
    obsidian,
    book,
    vault,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.close();
      await vault.write(EMPTY, "---\norca-book: 1\n---\n\n# Body\n");
      vault.touch(NEW_CHAPTER);
      await obsidian.open(EMPTY);
      await book.open();

      await expect(book.empty).toContainText("Empty book has no pages yet");
      await book.uncovered();
      const button = await book.newChapter.boundingBox();
      expect(button?.height).toBeGreaterThanOrEqual(TOUCH);
      // A phone's button is as wide as the column, and a tablet's
      // keeps its own width.
      if (device === "phone") expect(button?.width).toBeGreaterThan(COLUMN - 1);
      else expect(button?.width).toBeLessThan(COLUMN);
      expect(await obsidian.cramped(PREVIEW_CONTROLS)).toEqual([]);
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} a preview that stopped says so over the pages, with the report a touch tall`, async ({
    obsidian,
    book,
    vault,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.close();
      // The book goes back on the shelf, so the pane opens with no
      // death behind it.
      await vault.modify(BOOK, await vault.read(BOOK));
      await book.open();
      await book.painted();
      await book.uncovered();

      const first = await book.kill(BOOK);
      await book.restarted(BOOK, first);
      await book.kill(BOOK);

      await expect(book.held).toBeVisible();
      await expect(book.held).toContainText("The preview stopped");
      await expect(book.sheets.first()).toBeVisible();
      const notice = await book.held.boundingBox();
      const report = await book.report.boundingBox();
      const pane = await book.bar.boundingBox();
      expect(notice && report && pane).toBeTruthy();
      expect(report?.height).toBeGreaterThanOrEqual(TOUCH);
      const right = (notice?.x ?? 0) + (notice?.width ?? 0);
      const edge = (pane?.x ?? 0) + (pane?.width ?? 0);
      // A phone's notice runs the width of the pane. A tablet's sits
      // at the top right.
      if (device === "phone") {
        expect(notice?.width).toBeGreaterThan((pane?.width ?? 0) - 32);
      } else {
        expect(notice?.width).toBeLessThanOrEqual(NOTICE);
        expect(edge - right).toBeLessThan(16);
      }
      expect(await obsidian.cramped(PREVIEW_CONTROLS)).toEqual([]);
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} a note changed under an edit stacks the two versions, with the author's edit first`, async ({
    obsidian,
    book,
    note,
    vault,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.close();
      const before = await vault.read(BOOK);
      await note.open(BOOK);
      await expect(note.page).toContainText("Pride and Prejudice");

      await note.edit("Dragged");
      await vault.modify(
        BOOK,
        before.replace("title: Pride and Prejudice", "title: Written outside"),
      );

      await expect(note.changed).toBeVisible();
      const buttons = note.changed.getByRole("button");
      await expect(buttons).toHaveText(CHOICES);
      const keep = await buttons.nth(0).boundingBox();
      const saved = await buttons.nth(1).boundingBox();
      expect(keep && saved).toBeTruthy();
      expect(saved?.y).toBeGreaterThanOrEqual((keep?.y ?? 0) + (keep?.height ?? 0));
      expect(keep?.height).toBeGreaterThanOrEqual(TOUCH);
      expect(saved?.height).toBeGreaterThanOrEqual(TOUCH);
      // A phone's buttons are one width, which is the column's.
      if (device === "phone") expect(keep?.width).toBe(saved?.width);

      await buttons.nth(1).click();
      await expect(note.page).toContainText("Written outside");
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });
}

// What this suite does not cover: the state of a book being set for the
// first time, whose words the desktop suite reads and whose spacing
// only a picture would hold; the notice of a book being set again; and
// the book from a newer orca, which the book note's own view draws.
