import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The chapter the fixture book lists with no note behind it. */
const MISSING = "Chapter Four";

test("a chapter with no note stands as an error, and its row opens the navigator at that entry", async ({
  book,
  exporting,
  navigator,
  obsidian,
}) => {
  await book.open();
  await book.painted();

  await exporting.open();
  await exporting.reaches("refused");
  await expect(exporting.dialog).toHaveAttribute("data-errors", "1");
  await expect(exporting.errors).toHaveCount(1);
  await expect(exporting.errors).toHaveAttribute("data-kind", "note");
  await expect(exporting.errors).toContainText(`Missing note: ${MISSING}`);
  await expect(exporting.errors).toContainText("Body");
  await expect(exporting.said).toHaveText("Fix 1 error to export");
  await expect(exporting.write).toBeDisabled();

  // The sidebar is closed, so the row has to reveal the navigator.
  await obsidian.collapse();
  await exporting.fixes.click();

  await expect(exporting.dialog).toHaveCount(0);
  await expect.poll(async () => obsidian.collapsed()).toEqual(false);
  await expect(navigator.entry(BOOK, MISSING)).toBeFocused();
  await expect(navigator.entry(BOOK, MISSING)).toHaveAttribute("data-kind", "missing");
});

// What this spec does not cover: the row on a phone, where the
// navigator is a drawer. The dialog there draws the same row.
