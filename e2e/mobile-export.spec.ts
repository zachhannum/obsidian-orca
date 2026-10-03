import type { Locator } from "@playwright/test";
import { boxOf, NEAR, type Box } from "./harness/box";
import { DIALOG, type Export } from "./harness/export";
import { DEVICES, TOUCH, type Obsidian } from "./harness/obsidian";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. It sits at the top of the vault. */
const BOOK = "Pride and Prejudice.md";

/** The files export writes, beside the book note. */
const FILE = "Pride and Prejudice.pdf";
const EPUB = "Pride and Prejudice.epub";

/** The note an embed that will not read is written into. */
const EMBEDS = "Acknowledgements.md";

/** The height Obsidian mobile reports for a phone's keyboard, about. */
const KEYBOARD = 336;

/** More errors than a dialog has room for on any screen. */
const MANY = 24;

/** One embed with no file behind it for each of those errors. */
const MANY_EMBEDS = Array.from(
  { length: MANY },
  (_, at) => `![[nowhere-${String(at)}.png]]`,
).join("\n\n");

/** The dialog's width on a tablet, which is the desktop's. */
const WIDE = 620;

/** Checks that the dialog is whole inside a window of this size. */
function inside(dialog: Box, device: "phone" | "tablet"): void {
  const { width, height } = DEVICES[device];
  expect(dialog.x).toBeGreaterThanOrEqual(0);
  expect(dialog.y).toBeGreaterThanOrEqual(0);
  expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
  expect(dialog.y + dialog.height).toBeLessThanOrEqual(height);
}

/** Checks that the buttons are one over the next, each at the same width. */
async function stacked(...buttons: Locator[]): Promise<void> {
  const boxes = await Promise.all(buttons.map(boxOf));
  for (const [at, box] of boxes.entries()) {
    const above = boxes[at - 1];
    if (above === undefined) continue;
    expect(box.y).toBeGreaterThanOrEqual(above.y + above.height);
    expect(Math.abs(box.x - above.x)).toBeLessThanOrEqual(NEAR);
    expect(Math.abs(box.width - above.width)).toBeLessThanOrEqual(NEAR);
  }
}

/** Checks what the dialog has on a phone and a tablet alike, in the state it is in. */
async function touchable(obsidian: Obsidian, exporting: Export): Promise<void> {
  expect(await obsidian.cramped(DIALOG)).toEqual([]);
  await expect(exporting.choose).toHaveCount(0);
  await expect(exporting.dialog.getByText("Share")).toHaveCount(0);
}

for (const device of ["phone", "tablet"] as const) {
  test(`on a ${device} the export dialog stacks its buttons and saves into the vault, as a sheet on a phone alone`, async ({
    obsidian,
    book,
    exporting,
    vault,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.open();
      await book.settled(BOOK);
      vault.touch(FILE);
      vault.touch(EPUB);

      await exporting.open();
      await exporting.reaches("ready");
      const dialog = await boxOf(exporting.dialog);
      inside(dialog, device);
      const wide = device === "phone" ? DEVICES.phone.width : WIDE;
      expect(Math.abs(dialog.width - wide)).toBeLessThanOrEqual(NEAR);
      // A phone docks the dialog as a sheet, and a tablet centers it.
      await expect(obsidian.sheet("orca-export")).toHaveCount(device === "phone" ? 1 : 0);
      await expect(exporting.grabber).toHaveCount(device === "phone" ? 1 : 0);
      const foot = DEVICES[device].height - (dialog.y + dialog.height);
      if (device === "phone") expect(Math.abs(foot)).toBeLessThanOrEqual(NEAR);
      else expect(Math.abs(foot - dialog.y)).toBeLessThanOrEqual(NEAR);

      await expect(exporting.label).toHaveText("Save to this vault");
      const label = await boxOf(exporting.label);
      const field = await boxOf(exporting.destination);
      if (device === "phone") {
        // The label is the heading over the field.
        expect(field.y).toBeGreaterThanOrEqual(label.y + label.height - NEAR);
        expect(Math.abs(field.x - label.x)).toBeLessThanOrEqual(NEAR);
      } else {
        expect(field.x).toBeGreaterThanOrEqual(label.x + label.width - NEAR);
        expect(field.y).toBeLessThan(label.y + label.height);
      }
      await stacked(exporting.write, exporting.cancel);
      await touchable(obsidian, exporting);

      await exporting.write.click();
      await exporting.reaches("written");
      await expect(exporting.files).toHaveCount(2);
      await expect(exporting.file("pdf")).toContainText("saved to this vault");
      inside(await boxOf(exporting.dialog), device);
      await stacked(exporting.openPdf, exporting.done);
      await touchable(obsidian, exporting);
      await exporting.close();
    } finally {
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} a refused export says why over its buttons, and its fix is a link at touch size`, async ({
    obsidian,
    book,
    exporting,
    vault,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.open();
      await book.settled(BOOK);
      const text = await vault.read(EMBEDS);
      await vault.modify(EMBEDS, `${text.trimEnd()}\n\n![[nowhere.png]]\n`);

      await exporting.open();
      await exporting.reaches("refused");
      await expect(exporting.errors).toHaveCount(1);
      await expect(exporting.said).toHaveText("Fix 1 error to export");
      await expect(exporting.write).toBeDisabled();
      inside(await boxOf(exporting.dialog), device);
      await stacked(exporting.said, exporting.write, exporting.cancel);
      await touchable(obsidian, exporting);
      // Obsidian mobile fills a button and raises it, and a link has neither.
      const fix = await exporting.fixes.first().evaluate((link) => {
        const { backgroundColor, boxShadow } = getComputedStyle(link);
        return { backgroundColor, boxShadow, height: link.getBoundingClientRect().height };
      });
      expect(fix.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(fix.boxShadow).toBe("none");
      expect(fix.height).toBeGreaterThanOrEqual(TOUCH);

      await exporting.close();
      await vault.restore();
      await book.settled(BOOK);
    } finally {
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device}, with more errors than the dialog has room for, the list scrolls and Export and Cancel stay on the screen`, async ({
    obsidian,
    book,
    exporting,
    vault,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.open();
      await book.settled(BOOK);
      const text = await vault.read(EMBEDS);
      await vault.modify(EMBEDS, `${text.trimEnd()}\n\n${MANY_EMBEDS}\n`);

      await exporting.open();
      await exporting.reaches("refused");
      await expect(exporting.dialog).toHaveAttribute("data-errors", String(MANY));
      inside(await boxOf(exporting.dialog), device);

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
    } finally {
      await obsidian.emulateMobile(false);
    }
  });
}

test("on a phone the export dialog ends above the keyboard, with the path and both buttons on the screen", async ({
  obsidian,
  book,
  exporting,
}) => {
  await obsidian.mobile("phone");
  try {
    await book.open();
    await book.settled(BOOK);
    await exporting.open();
    await exporting.reaches("ready");

    await obsidian.keyboard(KEYBOARD);
    await exporting.destination.focus();
    const above = DEVICES.phone.height - KEYBOARD;
    const dialog = await boxOf(exporting.dialog);
    expect(dialog.y).toBeGreaterThanOrEqual(0);
    expect(Math.abs(dialog.y + dialog.height - above)).toBeLessThanOrEqual(NEAR);
    for (const part of [exporting.destination, exporting.write, exporting.cancel]) {
      const box = await boxOf(part);
      expect(box.y).toBeGreaterThanOrEqual(dialog.y);
      expect(box.y + box.height).toBeLessThanOrEqual(above + NEAR);
    }
    await exporting.destination.fill("Drafts/Book");
    await expect(exporting.destination).toHaveValue("Drafts/Book");
    await expect(exporting.write).toBeEnabled();

    await exporting.grabber.click();
    await expect(exporting.dialog).toHaveCount(0);
  } finally {
    await obsidian.keyboard(undefined);
    await obsidian.emulateMobile(false);
  }
});

// What this suite does not cover: the dialog against its artboard pixel
// for pixel, which emulation cannot give; `Share`, which the dialog
// does not have yet; the writing state, which is gone before a spec
// can measure it; a failed write, which nothing here can cause and
// which draws the refused state's line; the keyboard itself, which
// emulation does not raise, so the spec sets the height Obsidian
// reports for one; and the pull on the title that drags a sheet shut,
// which is Obsidian's own.
