import { boxOf, NEAR } from "./harness/box";
import { PAGE } from "./harness/note";
import { DEVICES, TOUCH } from "./harness/obsidian";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The space the page keeps at each side of its column. */
const SIDE = 24;

/** The most a scrollbar takes from the window's width. */
const STRIP = 20;

/** The width the column stops growing at. */
const COLUMN = 700;

test("on a phone the book page is one column, with Export at the width of it", async ({
  obsidian,
  note,
  exporting,
}) => {
  await obsidian.mobile("phone");
  try {
    await note.open(BOOK);
    await note.painted();
    await obsidian.put("left");
    await obsidian.put("right");

    // A drawer slides away, so the column is read once it has stopped.
    await expect
      .poll(async () => Math.abs((await boxOf(note.column)).x - SIDE))
      .toBeLessThanOrEqual(NEAR);
    const column = await boxOf(note.column);
    // The window keeps a strip for its scrollbar under emulation, which
    // a phone does not, so the column is held to the pane it is in.
    const pane = await boxOf(note.page);
    const inset = column.x - pane.x;
    expect(Math.abs(column.width - (pane.width - 2 * inset))).toBeLessThanOrEqual(NEAR);
    expect(column.width).toBeGreaterThan(DEVICES.phone.width - 2 * SIDE - STRIP);
    // Nothing is wider than the column, so the page scrolls one way.
    expect(
      await note.page.evaluate((page) => page.scrollWidth <= page.clientWidth),
    ).toBe(true);

    const exports = await boxOf(note.exports);
    expect(Math.abs(exports.x - column.x)).toBeLessThanOrEqual(NEAR);
    expect(Math.abs(exports.width - column.width)).toBeLessThanOrEqual(NEAR);

    // A label sits beside its value.
    const field = await boxOf(note.metadata("title"));
    expect(field.x).toBeGreaterThan(column.x + NEAR);
    expect(field.height).toBeGreaterThanOrEqual(TOUCH - NEAR);

    for (const entry of await note.entries.all()) {
      expect((await boxOf(entry)).height).toBeGreaterThanOrEqual(TOUCH - NEAR);
    }
    expect(await obsidian.cramped(PAGE)).toEqual([]);
    // No control is named by a tooltip alone.
    await expect(note.page.locator("[title], [aria-label]")).toHaveCount(0);

    await note.exports.click();
    // The fixture book lists a chapter with no note, so preflight refuses it.
    await exporting.reaches("refused");
    await exporting.close();
  } finally {
    await obsidian.emulateMobile(false);
  }
});

test("on a phone a tap picks the cover, its controls are at touch size, and the size in pixels is left out", async ({
  obsidian,
  note,
  vault,
}) => {
  vault.touch(BOOK);
  await obsidian.mobile("phone");
  try {
    await note.open(BOOK);
    await note.painted();
    await obsidian.put("left");
    await obsidian.put("right");

    await note.choose("device");
    await expect(note.pictured).toHaveText("device.png");
    await expect(note.measured).toBeHidden();
    expect((await boxOf(note.uncover)).width).toBeGreaterThanOrEqual(TOUCH - NEAR);
    expect(await obsidian.cramped(PAGE)).toEqual([]);
    await expect(note.page.locator("[title], [aria-label]")).toHaveCount(0);

    await note.uncover.click();
    await expect(note.picture).toHaveCount(0);
  } finally {
    await obsidian.emulateMobile(false);
    await note.close();
    await vault.restore();
  }
});

test("on a tablet the book page is the desktop's column, with each control at touch size", async ({
  obsidian,
  note,
}) => {
  await obsidian.mobile("tablet");
  try {
    await note.open(BOOK);
    await note.painted();
    await obsidian.put("left");
    await obsidian.put("right");

    const column = await boxOf(note.column);
    const pane = await boxOf(note.page);
    expect(Math.abs(column.width - COLUMN)).toBeLessThanOrEqual(NEAR);
    // The column is in the middle of the pane.
    expect(
      Math.abs(column.x - pane.x - (pane.x + pane.width - column.x - column.width)),
    ).toBeLessThanOrEqual(2 * NEAR);

    const exports = await boxOf(note.exports);
    expect(Math.abs(exports.x - column.x)).toBeLessThanOrEqual(NEAR);
    expect(exports.width).toBeLessThan(column.width / 2);

    for (const entry of await note.entries.all()) {
      expect((await boxOf(entry)).height).toBeGreaterThanOrEqual(TOUCH - NEAR);
    }
    expect(await obsidian.cramped(PAGE)).toEqual([]);
    await expect(note.page.locator("[title], [aria-label]")).toHaveCount(0);
  } finally {
    await obsidian.emulateMobile(false);
  }
});

// What this suite does not cover: a drag onto the cover, which a phone
// does not have; the page against its artboard pixel
// for pixel, which emulation cannot give; the keyboard a tap on a value
// brings up, which a real device draws; the two cards for the CSS and
// the book, which the page does not have on any platform; and the
// refused state's button.
