import { DEVICES, TOUCH } from "./harness/obsidian";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The height the keyboard is raised to, which emulation has none of. */
const KEYBOARD = 336;

/** The height of the toolbar over the keyboard, which is Obsidian's own. */
const TOOLBAR = 52;

/** The pixels a box may be off its place by. */
const NEAR = 2;

/** A rule with a line longer than a drawer is wide, and a declaration the engine skips. */
const TYPED = `\n${Array.from({ length: 8 }, () => "section.chapter-opening").join(" > ")} { float: left; }`;

/** The marks the toolbar holds on each device. */
const MARKS = {
  phone: ["{", "}", ":", ";"],
  tablet: ["{", "}", ":", ";", "#", ".", "@"],
};

for (const device of ["phone", "tablet"] as const) {
  test(`on a ${device} the CSS view shows a flag's card at the caret, draws every fold chevron, and puts a toolbar over the keyboard`, async ({
    obsidian,
    book,
    panel,
    vault,
  }) => {
    // The test types into the book note, and puts back what it held.
    const own = await vault.read(BOOK);
    vault.touch(BOOK);
    await obsidian.mobile(device);
    try {
      await book.open();
      await book.settled(BOOK);
      await panel.open();
      await panel.toCss.click();
      await expect(panel.editor).toBeVisible();

      // No pointer is over the gutter, and the chevron of a rule that
      // can fold is drawn.
      await expect(panel.foldMarkers.first()).toBeVisible();

      await expect(panel.toolbar).toBeHidden();
      await panel.typeCss(TYPED);
      await expect.poll(async () => vault.read(BOOK)).toContain(TYPED);
      await expect(panel.flags).toHaveCount(1);
      const line = (await panel.cssText()).split("\n").length;

      // The caret is after the rule, outside the flagged declaration.
      await expect(panel.card).toBeHidden();
      for (let step = 0; step < 5; step += 1) await panel.code.press("ArrowLeft");
      await expect(panel.card).toBeVisible();
      await expect(panel.card).toContainText("float");
      await expect(panel.card).toContainText(`line ${String(line)}`);
      await panel.code.press("ControlOrMeta+Home");
      await expect(panel.card).toBeHidden();

      // A long line scrolls sideways until the author turns wrapping on.
      expect(await panel.scrollsSideways()).toBe(true);
      await panel.wrap.click();
      await expect.poll(() => panel.scrollsSideways()).toBe(false);
      await panel.wrap.click();
      await expect.poll(() => panel.scrollsSideways()).toBe(true);

      // The toolbar is there while the CSS view has the caret.
      await panel.code.click();
      await expect(panel.toolbar).toBeVisible();
      await expect(panel.marks).toHaveText(MARKS[device]);
      for (const name of ["undo", "redo", "search", "hide"] as const) {
        const box = await panel.box(panel.tool(name));
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
      }

      await panel.code.press("ControlOrMeta+End");
      const before = await panel.cssText();
      await panel.marks.filter({ hasText: ":" }).click();
      await expect.poll(() => panel.cssText()).toBe(`${before}:`);
      await expect(panel.code).toBeFocused();
      await panel.tool("undo").click();
      await expect.poll(() => panel.cssText()).toBe(before);
      await panel.tool("redo").click();
      await expect.poll(() => panel.cssText()).toBe(`${before}:`);
      await panel.tool("undo").click();
      await expect.poll(() => panel.cssText()).toBe(before);

      // The sheet ends above the toolbar, and the toolbar above the
      // keyboard, with the caret's line in sight.
      await obsidian.keyboard(KEYBOARD);
      const above = DEVICES[device].height - KEYBOARD;
      await expect
        .poll(async () => {
          const bar = await panel.box(panel.toolbar);
          return bar.y + bar.height;
        })
        .toBe(above);
      const bar = await panel.box(panel.toolbar);
      expect(bar.height).toBe(TOOLBAR);
      expect(bar.width).toBe(DEVICES[device].width);
      await expect
        .poll(async () => {
          const sheet = await panel.box(panel.editor);
          return Math.abs(sheet.y + sheet.height - bar.y);
        })
        .toBeLessThanOrEqual(NEAR);
      await expect
        .poll(async () => {
          const caret = await panel.box(panel.cursors.first());
          return caret.y + caret.height;
        })
        .toBeLessThanOrEqual(bar.y);
      if (device === "phone") {
        // The CSS view is as wide as the drawer, less the margin around the sheet.
        const sheet = await panel.box(panel.editor);
        expect(sheet.width).toBeGreaterThanOrEqual((await panel.width()) - 2 * 16);
      }

      // Search opens from the toolbar, at the size of a touch, and the
      // toolbar stays while the search has the caret.
      await panel.tool("search").click();
      await expect(panel.search).toBeVisible();
      await expect(panel.toolbar).toBeVisible();
      const find = await panel.box(panel.search.getByLabel("Find", { exact: true }));
      expect(find.height).toBeGreaterThanOrEqual(TOUCH);
      expect(find.width).toBeGreaterThanOrEqual(140);

      await panel.code.click();
      await panel.tool("hide").click();
      await expect(panel.toolbar).toBeHidden();
    } finally {
      await obsidian.keyboard(undefined);
      vault.touch(BOOK);
      await vault.modify(BOOK, own);
      await obsidian.emulateMobile(false);
    }
  });
}

test("on desktop the CSS view keeps the hover card and the gutter, and draws no toolbar", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  try {
    await book.open();
    await book.settled(BOOK);
    await panel.open();
    await panel.toCss.click();
    await expect(panel.editor).toBeVisible();

    await panel.typeCss(TYPED);
    await expect(panel.flags).toHaveCount(1);
    await expect(panel.toolbar).toHaveCount(0);

    // The caret in the declaration shows no card, and a hover does.
    for (let step = 0; step < 5; step += 1) await panel.code.press("ArrowLeft");
    await expect(panel.code).toBeFocused();
    await expect(panel.card).toBeHidden();
    await panel.flags.hover();
    await expect(panel.card).toBeVisible();
    await expect(panel.card).toContainText("book.css:");

    // A chevron shows while the pointer is over the gutter.
    await expect(panel.foldMarkers.first()).toBeHidden();
    await panel.gutters.hover();
    await expect(panel.foldMarkers.first()).toBeVisible();
    await panel.toControls.click();
  } finally {
    vault.touch(BOOK);
    await vault.modify(BOOK, own);
  }
});

// What this suite does not cover: a system keyboard, which emulation
// does not raise, so the height is one the suite sets and the toolbar
// is never drawn beside Obsidian's own; a finger, because emulation
// sends a mouse; a drawer pinned on a tablet, which the harness cannot
// pin; completion by touch; and the view against its artboard pixel for
// pixel, which emulation cannot give.
