import { PREVIEW_CONTROLS } from "./harness/book";
import { boxOf, NEAR } from "./harness/box";
import { DEVICES } from "./harness/obsidian";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault, and the pages it sets to. */
const BOOK = "Pride and Prejudice.md";
const PAGES = 19;

/** The three views, by the label of the switch and the name the surface gives. */
const VIEWS = [
  ["Single page", "single"],
  ["Spread", "spread"],
  ["Grid", "grid"],
] as const;

/** The sheets a grid seats across, as the artboards draw it. */
const ACROSS = { phone: 2, tablet: 6 } as const;

/** The note the last section is read from, and the image it embeds. */
const LAST_NOTE = "Acknowledgements.md";
const DEVICE = "![[device.png]]";

/** The place each device draws the folio, the arrows and the count. */
const PLACE = { phone: "under", tablet: "bar" } as const;

/** The widest a tablet's bar draws the chapter. */
const CHAPTER_WIDTH = 220;

/** A place too long for one line of a phone's card. */
const LONG_PLACE =
  "Manuscript/Part the Second/A chapter with a very long name indeed.md:1234:56";

/** The space a spread leaves between its two pages. */
const SPINE = 2;

for (const device of ["phone", "tablet"] as const) {
  test(`a ${device} writes no status bar item, and draws the folio, the arrows and the count ${device === "phone" ? "under the page" : "in the preview's bar"}`, async ({
    obsidian,
    book,
  }) => {
    await obsidian.mobile(device);
    try {
      // Mobile keeps a workspace of its own, so a preview an earlier
      // spec left in it is closed here, and this one's before leaving.
      await book.close();
      await book.open();
      await book.settled(BOOK);
      await book.uncovered();

      const foot = await book.footed(PLACE[device]);
      await expect(book.status).toHaveCount(0);
      await expect(foot).toBeVisible();
      await expect(foot.getByTestId("orca-folio")).toHaveValue("1");
      await expect(foot.getByTestId("orca-total")).toHaveText(`of ${String(PAGES)}`);
      await expect(foot.getByLabel("Previous page")).toHaveCount(1);
      await expect(foot.getByLabel("Next page")).toHaveCount(1);
      await expect(foot.getByTestId("orca-issues-count")).toHaveCount(1);
      // The bar keeps the views, the chapter and Export.
      const chapter = book.bar.getByTestId("orca-chapter");
      await expect(chapter).toBeVisible();
      await expect(book.exportIn).toBeVisible();
      if (device === "phone") {
        // The foot is under the pages rather than over them, and clear
        // of the bar Obsidian floats over the foot of the screen.
        const well = await book.surface.boundingBox();
        const under = await foot.boundingBox();
        expect(under?.y).toBeGreaterThanOrEqual((well?.y ?? 0) + (well?.height ?? 0));
        expect(await book.clearance()).toBeGreaterThanOrEqual(12);
        await expect(book.bar.getByTestId("orca-folio")).toHaveCount(0);
      } else {
        // A tablet's bar has the width for them, and the chapter is no
        // wider than a name needs.
        await expect(book.foot).toBeHidden();
        expect((await chapter.boundingBox())?.width).toBeLessThanOrEqual(CHAPTER_WIDTH);
      }

      await book.next.click();
      await expect(book.surface).toHaveAttribute("data-first", "2");
      await expect(book.folio).toHaveValue("2");
      await expect(book.status).toHaveCount(0);
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });

  test(`a ${device} offers the single view, the spread and the grid, and each paints`, async ({
    obsidian,
    book,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.close();
      await book.open();
      await book.settled(BOOK);
      await book.uncovered();
      await book.footed(PLACE[device]);

      for (const [label, mode] of VIEWS) {
        await expect(book.view(label)).toBeVisible();
        if (mode !== "single") await book.show(label, mode);
        await expect(book.surface).toHaveAttribute("data-view", mode);
        await expect(book.page).toBeVisible();
      }

      // The grid is as many sheets across as the artboard draws, and
      // the foot names the screenful by its span.
      expect(await book.columns()).toBe(ACROSS[device]);
      const shown = await book.showing();
      expect(shown).toBeGreaterThanOrEqual(ACROSS[device]);
      await expect(book.sheets).toHaveCount(shown);
      await expect(book.total).toHaveText(
        `1–${String(shown)} of ${String(PAGES)}`,
      );
      await expect(book.folio).toBeHidden();

      await book.show("Single page", "single");
      await expect(book.sheets).toHaveCount(1);
      await expect(book.folio).toBeVisible();
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });

  test(`every control the preview draws on a ${device} is the size of a touch`, async ({
    obsidian,
    book,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.close();
      await book.open();
      await book.settled(BOOK);
      await book.uncovered();
      await book.footed(PLACE[device]);
      // A page with one either side of it, so neither arrow is off.
      await book.next.click();
      await expect(book.surface).toHaveAttribute("data-first", "2");

      expect(await obsidian.cramped(PREVIEW_CONTROLS)).toEqual([]);
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });
}

test("a phone on its side has the folio, the arrows and the count in the preview's bar", async ({
  obsidian,
  book,
}) => {
  await obsidian.mobile("phone");
  try {
    await book.close();
    await book.open();
    await book.settled(BOOK);
    await book.uncovered();
    await book.footed("under");
    await book.next.click();
    await expect(book.surface).toHaveAttribute("data-first", "2");

    await obsidian.turn();
    const bar = await book.footed("bar");
    await expect(book.foot).toBeHidden();
    await expect(bar.getByTestId("orca-folio")).toHaveValue("2");
    await expect(bar.getByTestId("orca-total")).toHaveText(`of ${String(PAGES)}`);
    await expect(bar.getByLabel("Previous page")).toBeVisible();
    await expect(bar.getByLabel("Next page")).toBeVisible();
    await expect(bar.getByTestId("orca-issues-count")).toHaveCount(1);
    await expect(book.exportIn).toBeVisible();
    await expect(book.status).toHaveCount(0);

    // The three views are offered on its side too, and the arrows turn.
    for (const [label] of VIEWS) await expect(book.view(label)).toBeVisible();
    await book.next.click();
    await expect(book.surface).toHaveAttribute("data-first", "3");
    expect(await obsidian.cramped(PREVIEW_CONTROLS)).toEqual([]);

    // Upright again, they go back under the page the pane was on.
    await obsidian.turn();
    const foot = await book.footed("under");
    await expect(foot.getByTestId("orca-folio")).toHaveValue("3");
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("a tablet has them in the preview's bar, upright and on its side", async ({ obsidian, book }) => {
  await obsidian.mobile("tablet");
  try {
    await book.close();
    await book.open();
    await book.settled(BOOK);
    await book.uncovered();
    await book.footed("bar");

    await obsidian.turn();
    await expect
      .poll(() => obsidian.page.evaluate(() => window.innerHeight > window.innerWidth))
      .toBe(true);
    const bar = await book.footed("bar");
    await expect(bar.getByTestId("orca-folio")).toHaveValue("1");
    await expect(book.foot).toBeHidden();
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("a phone's spread is as wide as the screen upright, and as tall as the pane on its side", async ({
  obsidian,
  book,
}) => {
  await obsidian.mobile("phone");
  try {
    await book.close();
    await book.open();
    await book.settled(BOOK);
    await book.uncovered();
    await book.footed("under");
    await book.show("Spread", "spread");
    // The second page is a verso, so both seats of the spread are set.
    await book.next.click();
    await expect(book.surface).toHaveAttribute("data-first", "2");
    await expect(book.sheets).toHaveCount(2);

    // Upright the two pages and the spine fill the width, and the
    // height is left over.
    await expect
      .poll(async () => {
        const { well, sheet } = await book.room(0);
        return Math.abs(sheet.width * 2 + SPINE - well.width);
      })
      .toBeLessThan(1);
    const upright = await book.room(0);
    expect(upright.sheet.height).toBeLessThan(upright.well.height);

    await obsidian.turn();
    await book.footed("bar");
    await expect
      .poll(async () => {
        const { well, sheet } = await book.room(0);
        return Math.abs(sheet.height - well.height);
      })
      .toBeLessThan(1);
    const turned = await book.room(0);
    expect(turned.sheet.width * 2 + SPINE).toBeLessThan(turned.well.width);
    await expect(book.surface).toHaveAttribute("data-first", "2");
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("on a tablet the warnings open over the page from the count, a long place wraps inside its card, and a tap on the page shuts them", async ({
  obsidian,
  book,
  vault,
}) => {
  await obsidian.mobile("tablet");
  try {
    await book.close();
    vault.touch(LAST_NOTE);
    await book.open();
    const painted = await book.settled(BOOK);
    await book.uncovered();
    const foot = await book.footed(PLACE.tablet);

    const note = await vault.read(LAST_NOTE);
    await vault.modify(LAST_NOTE, note.replace(DEVICE, "![[nothing here.png]]"));
    await expect.poll(async () => book.painted()).toBeGreaterThan(painted);

    const count = foot.getByTestId("orca-issues-count");
    await expect(book.counted).toHaveText("1 warning");
    await expect(book.issues.first()).toBeHidden();

    await count.click();
    await expect(book.issues.first()).toBeVisible();
    await expect(count).toHaveAttribute("aria-expanded", "true");
    // A tablet has no sheet: the warnings are in the pane, under its
    // bar and over the pages, and the pages have not moved to make room.
    await expect(obsidian.sheet()).toHaveCount(0);
    const panel = await book.issues.first().boundingBox();
    const held = await foot.boundingBox();
    const well = await book.surface.boundingBox();
    expect(panel && held && well).toBeTruthy();
    expect(panel?.y).toBeGreaterThanOrEqual((held?.y ?? 0) + (held?.height ?? 0));
    expect((panel?.y ?? 0) + (panel?.height ?? 0)).toBeLessThan(
      (well?.y ?? 0) + (well?.height ?? 0),
    );
    // A place longer than the card wraps in it, and nothing scrolls
    // sideways.
    expect(await book.issuesSpill(LONG_PLACE)).toBe(0);
    // The place a warning names is a control too.
    expect(await obsidian.cramped(PREVIEW_CONTROLS)).toEqual([]);

    await book.surface.click({ position: { x: 8, y: 8 } });
    await expect(book.issues.first()).toBeHidden();
    await expect(count).toHaveAttribute("aria-expanded", "false");
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("on a phone the count opens the warnings as a sheet, which closes from its grabber and from a tap outside it", async ({
  obsidian,
  book,
  vault,
}) => {
  await obsidian.mobile("phone");
  try {
    await book.close();
    vault.touch(LAST_NOTE);
    await book.open();
    const painted = await book.settled(BOOK);
    await book.uncovered();
    const foot = await book.footed(PLACE.phone);

    const note = await vault.read(LAST_NOTE);
    await vault.modify(LAST_NOTE, note.replace(DEVICE, "![[nothing here.png]]"));
    await expect.poll(async () => book.painted()).toBeGreaterThan(painted);

    const count = foot.getByTestId("orca-issues-count");
    await expect(book.counted).toHaveText("1 warning");
    await expect(book.issues.first()).toBeHidden();

    await count.click();
    await expect(count).toHaveAttribute("aria-expanded", "true");
    await expect(book.issues.first()).toBeVisible();
    // The sheet is Obsidian's docked modal: as wide as the screen, at
    // its foot, with the count as its title and the screen dimmed
    // behind it.
    await expect(obsidian.sheet("orca-warnings")).toHaveCount(1);
    await expect(book.warnings).toContainText("1 warning");
    const sheet = await boxOf(book.warnings);
    expect(Math.abs(sheet.width - DEVICES.phone.width)).toBeLessThanOrEqual(NEAR);
    expect(Math.abs(sheet.y + sheet.height - DEVICES.phone.height)).toBeLessThanOrEqual(NEAR);
    expect(sheet.y).toBeGreaterThan(0);
    expect(
      await obsidian
        .backdrop("orca-warnings")
        .evaluate((bg) => getComputedStyle(bg).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    // A place longer than the card wraps in it, and nothing scrolls
    // sideways. The grabber and the place are controls at touch size.
    expect(await book.issuesSpill(LONG_PLACE)).toBe(0);
    expect(await obsidian.cramped('[data-testid="orca-warnings"]')).toEqual([]);

    await book.grabber.click();
    await expect(book.warnings).toHaveCount(0);
    await expect(count).toHaveAttribute("aria-expanded", "false");
    await expect(book.issues.first()).toBeHidden();

    await count.click();
    await expect(book.issues.first()).toBeVisible();
    await boxOf(book.warnings);
    await obsidian.backdrop("orca-warnings").click({ position: { x: 10, y: 10 } });
    await expect(book.warnings).toHaveCount(0);
    await expect(count).toHaveAttribute("aria-expanded", "false");
    await expect(book.issues.first()).toBeHidden();
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("on a phone a pinch zooms the page about the point between the fingers, and a drag moves it", async ({
  obsidian,
  book,
}) => {
  await obsidian.mobile("phone");
  try {
    await book.close();
    await book.open();
    await book.settled(BOOK);
    await book.uncovered();
    // A touch screen zooms by pinch, so the bar draws no control.
    await book.zoomed(100);
    await expect(book.zoomIn).toHaveCount(0);
    await expect(book.zoomPercent).toHaveCount(0);

    const sheet = await book.seat(0).boundingBox();
    if (sheet === null) throw new Error("no page is on screen");
    const middle = { x: sheet.x + sheet.width * 0.4, y: sheet.y + sheet.height * 0.4 };
    const before = await book.share(middle);
    const fingers = (apart: number): { x: number; y: number; id: number }[] => [
      { x: middle.x - apart / 2, y: middle.y, id: 0 },
      { x: middle.x + apart / 2, y: middle.y, id: 1 },
    ];

    await obsidian.touch("touchStart", fingers(60));
    try {
      for (let step = 1; step <= 10; step++) {
        await obsidian.touch("touchMove", fingers(60 + step * 12));
      }
      // The fingers end three times as far apart as they began.
      await book.zoomed(300);
      await obsidian.touch("touchEnd", []);
    } catch (cause) {
      await obsidian.touch("touchCancel", []);
      throw cause;
    }

    const after = await book.share(middle);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);

    // One finger moves the zoomed page, and the zoom stays.
    const pan = (await book.surface.getAttribute("data-pan")) ?? "";
    await obsidian.touch("touchStart", [middle]);
    for (let step = 1; step <= 10; step++) {
      await obsidian.touch("touchMove", [{ x: middle.x - step * 6, y: middle.y - step * 6 }]);
    }
    await obsidian.touch("touchEnd", []);
    await expect(book.surface).not.toHaveAttribute("data-pan", pan);
    await book.zoomed(300);
    const moved = await book.share(middle);
    expect(moved.x).toBeGreaterThan(after.x);
    expect(moved.y).toBeGreaterThan(after.y);
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

// What this suite does not cover: a swipe and the share sheet, which
// the preview does not answer yet; a drag across a zoomed page on a
// real phone, where Obsidian's own drawers listen for the same finger;
// the insets a real phone's
// notch and home bar take from the bar and the foot, which emulation
// leaves at nothing; the warnings sheet on a phone on its side, and
// with more warnings than it has room for; and the
// pull on the title that drags a sheet shut, which is Obsidian's own.
