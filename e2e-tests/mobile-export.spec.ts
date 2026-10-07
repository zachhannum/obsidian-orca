import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { boxOf, boxesOf, NEAR, type Box } from "./harness/box";
import { DIALOG, type Export } from "./harness/export";
import { DEVICES, SHEET, TOUCH, type Obsidian } from "./harness/obsidian";
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
  const boxes = await boxesOf(...buttons);
  for (const [at, box] of boxes.entries()) {
    const above = boxes[at - 1];
    if (above === undefined) continue;
    expect(box.y).toBeGreaterThanOrEqual(above.y + above.height);
    expect(Math.abs(box.x - above.x)).toBeLessThanOrEqual(NEAR);
    expect(Math.abs(box.width - above.width)).toBeLessThanOrEqual(NEAR);
  }
}

/**
 * Checks what the dialog has on a phone and a tablet alike, in the state
 * it is in. Emulation runs in a window that cannot share a file, so a
 * spec that has not stood in for the share sheet sees no Share.
 */
async function touchable(obsidian: Obsidian, exporting: Export): Promise<void> {
  expect(await obsidian.cramped(DIALOG)).toEqual([]);
  await expect(exporting.choose).toHaveCount(0);
  await expect(exporting.share).toHaveCount(0);
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

  test(`on a ${device} Share hands over the files the session drew and writes none into the vault, and a cancelled share changes nothing`, async ({
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
      await exporting.sharing();

      // Export writes the files the dialog made for the share sheet.
      await exporting.open();
      await exporting.reaches("ready");
      await expect(exporting.share).toBeEnabled();
      await exporting.write.click();
      await exporting.reaches("written");
      await expect(exporting.files).toHaveCount(2);
      const written = await vault.bytes(FILE);
      expect(written.equals(await book.pdf(BOOK))).toBe(true);
      await expect(exporting.file("pdf")).toHaveAttribute("data-bytes", String(written.length));
      await exporting.close();
      await vault.remove(FILE);
      await vault.remove(EPUB);

      await exporting.open();
      await exporting.reaches("ready");
      await expect(exporting.share).toHaveText("Share");
      await stacked(exporting.write, exporting.share, exporting.cancel);
      inside(await boxOf(exporting.dialog), device);
      expect(await obsidian.cramped(DIALOG)).toEqual([]);

      // The files are made before the tap, so the tap itself opens the
      // share sheet. A share the author cancels leaves the dialog as it was.
      await exporting.ends("cancels");
      const said = await obsidian.notices(async () => {
        await exporting.share.click();
        await expect.poll(async () => (await exporting.handed()).length).toBe(1);
        await exporting.reaches("ready");
      });
      await expect(exporting.dialog.getByTestId("orca-export-progress")).toHaveCount(0);
      expect(said).toEqual([]);
      await expect(exporting.said).toBeEmpty();
      await expect(exporting.share).toBeEnabled();

      // Share hands over the ticked formats alone.
      await exporting.formats("pdf");
      await exporting.share.click();
      await expect.poll(async () => (await exporting.handed()).length).toBe(2);
      await exporting.formats("pdf", "epub");

      // A web view that still refuses the tap keeps the files, and the
      // next tap hands them over.
      await exporting.ends("refuses");
      await exporting.share.click();
      await exporting.reaches("made");
      await expect(exporting.files).toHaveCount(2);
      const row = exporting.file("pdf");
      await expect(row).toContainText(FILE);
      await expect(row).toContainText(/[\d,]+ pages · [\d.]+ (KB|MB)$/);
      await stacked(exporting.share, exporting.done);
      inside(await boxOf(exporting.dialog), device);
      expect(await obsidian.cramped(DIALOG)).toEqual([]);

      await exporting.ends("shares");
      await exporting.share.click();
      await expect(exporting.dialog).toHaveCount(0);

      // Each share hands over both files under the book's file name,
      // and the PDF is the one the session draws.
      const handed = await exporting.handed();
      expect(handed).toHaveLength(4);
      const drawn = await book.pdf(BOOK);
      expect(handed[1]?.map(({ name }) => name)).toEqual([FILE]);
      expect(handed[1]?.[0]?.bytes.equals(drawn)).toBe(true);
      for (const files of [handed[0], handed[2], handed[3]]) {
        if (files === undefined) throw new Error("a share handed nothing over");
        expect(files.map(({ name, type }) => ({ name, type }))).toEqual([
          { name: FILE, type: "application/pdf" },
          { name: EPUB, type: "application/epub+zip" },
        ]);
        expect(files[0]?.bytes.equals(drawn)).toBe(true);
      }
      const folder = mkdtempSync(join(tmpdir(), "orca-shared-"));
      try {
        const shared = join(folder, FILE);
        writeFileSync(shared, handed[3]?.[0]?.bytes ?? Buffer.alloc(0));
        const check = spawnSync("qpdf", ["--check", shared], { encoding: "utf8" });
        expect(check.status, check.stdout + check.stderr).toBe(0);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
      const kept = await vault.notes();
      expect(kept).not.toContain(FILE);
      expect(kept).not.toContain(EPUB);
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
      const dialog = await boxOf(exporting.dialog);
      inside(dialog, device);
      // A sheet with more than it has room for is still not the whole
      // screen: the page is in sight over it.
      if (device === "phone") {
        expect(dialog.height).toBeLessThanOrEqual(DEVICES.phone.height * SHEET + NEAR);
      }

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
    expect(dialog.height).toBeLessThanOrEqual(above * SHEET + NEAR);
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
// for pixel, which emulation cannot give; the share sheet, which is the
// operating system's own window, so a stand-in for `navigator.share`
// takes the files; how long a tap stays good for a share on a device;
// a share after an edit with the dialog open, which makes the files
// again; the line and the bar that say the files are being made, which
// are gone before a spec can measure them;
// a share that fails for a reason other than a cancel or a spent tap,
// which draws the refused state's line; the writing state, which is gone before a spec
// can measure it; a failed write, which nothing here can cause and
// which draws the refused state's line; the keyboard itself, which
// emulation does not raise, so the spec sets the height Obsidian
// reports for one; and the pull on the title that drags a sheet shut,
// which is Obsidian's own.
