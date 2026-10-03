import { TOUCH } from "./harness/obsidian";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The vault folder a book's own font files are in. */
const FONTS = "fonts";

/** The family the engine carries. */
const CARRIED = "EB Garamond";

/** A family the fixture vault holds files of. */
const FIXTURE_FONT = "Alegreya";

/** A count the fixture book sets, and the row that steps it. */
const COUNT = "heading-1-space-above";

/** A chapter of that book. */
const CHAPTER = "Chapter Twelve.md";

/** A view Obsidian keeps in the right drawer beside the panel. */
const OUTLINE = "outline";

/** The width at which the panel puts a label over its control. */
const NARROW = 360;

for (const device of ["phone", "tablet"] as const) {
  test(`on a ${device} a book opens with both drawers shut, and the right drawer opens on the panel for that book`, async ({
    obsidian,
    book,
    panel,
    manuscript,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.close();
      await obsidian.put("left");
      await obsidian.put("right");
      // Another view is the drawer's tab, so the panel is not there
      // only because it was left there.
      await obsidian.fronts(OUTLINE);

      // The panel names its book once orca has handed it the preview,
      // so the drawers are read after that.
      const shut = async (): Promise<void> => {
        await expect(panel.bookName).toContainText("Pride and Prejudice");
        expect(await obsidian.collapsed("right")).toBe(true);
        expect(await obsidian.collapsed("left")).toBe(true);
      };
      await book.open();
      await book.settled(BOOK);
      await shut();

      // The command on a book already open, and a chapter swapped for
      // the book, hand the panel the preview by the same call.
      await book.open();
      await book.settled(BOOK);
      await shut();
      await book.close();
      await obsidian.open(CHAPTER);
      await manuscript.asBook.click();
      await book.settled(BOOK);
      await shut();

      await obsidian.expand("right");
      await expect(panel.panel).toBeVisible();
      await expect(panel.bookName).toContainText("Pride and Prejudice");
      await expect(panel.control("trim")).toBeVisible();
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} the panel draws its header, its groups and its rows at the size of a touch, and the header switches the view`, async ({
    obsidian,
    book,
    panel,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.open();
      await book.settled(BOOK);
      await panel.open();

      // The header names the view in the case it is written in, and the
      // book beside it.
      await expect(panel.title).toHaveText("Design");
      await expect(panel.title).toHaveCSS("text-transform", "none");
      await expect(panel.bookName).toContainText("Pride and Prejudice");
      expect((await panel.grouped()).slice(0, 2)).toEqual(["Page", "Text"]);
      await expect(panel.groupNames.first()).toHaveCSS("font-weight", "600");

      // A label is over its control in a narrow drawer and beside it in
      // a wide one, as on desktop.
      const label = await panel.box(panel.label("trim"));
      const trim = await panel.box(panel.control("trim"));
      if ((await panel.width()) <= NARROW) {
        expect(label.y + label.height).toBeLessThanOrEqual(trim.y);
        expect(Math.abs(label.x - trim.x)).toBeLessThan(1);
      } else {
        expect(label.x + label.width).toBeLessThanOrEqual(trim.x);
        expect(label.y).toBeLessThan(trim.y + trim.height);
      }
      for (const field of [panel.control("trim"), panel.font, panel.control("body-size")]) {
        expect((await panel.box(field)).height).toBeGreaterThanOrEqual(TOUCH);
      }

      // A margin is typed. Two share a line, which has no room for
      // their buttons.
      await expect(panel.up("margin-inside")).toBeHidden();
      const inside = await panel.box(panel.control("margin-inside"));
      const outside = await panel.box(panel.control("margin-outside"));
      expect(Math.abs(inside.y - outside.y)).toBeLessThan(1);
      expect(inside.x + inside.width).toBeLessThanOrEqual(outside.x);

      // A switch with a label is at the end of the label's line.
      const hyphenate = await panel.box(panel.label("body-hyphens"));
      const toggle = await panel.box(panel.control("body-hyphens"));
      expect(hyphenate.x + hyphenate.width).toBeLessThanOrEqual(toggle.x);
      expect(toggle.y).toBeLessThan(hyphenate.y + hyphenate.height);
      expect(toggle.y + toggle.height).toBeGreaterThan(hyphenate.y);

      await panel.toCss.click();
      await expect(panel.title).toHaveText("CSS");
      await expect(panel.editor).toBeVisible();
      await panel.toControls.click();
      await expect(panel.title).toHaveText("Design");
      await expect(panel.control("trim")).toBeVisible();
    } finally {
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} a number field has a button at each end, and a press on each moves the value one step`, async ({
    obsidian,
    book,
    panel,
    vault,
  }) => {
    vault.touch(BOOK);
    await obsidian.mobile(device);
    try {
      await book.open();
      await book.settled(BOOK);
      await panel.open();

      const field = panel.control(COUNT);
      await field.scrollIntoViewIfNeeded();
      await expect(field).toHaveValue("7");
      const text = await panel.box(field);
      const down = await panel.box(panel.down(COUNT));
      const up = await panel.box(panel.up(COUNT));
      expect(down.x + down.width).toBeLessThanOrEqual(text.x + 0.5);
      expect(up.x).toBeGreaterThanOrEqual(text.x + text.width - 0.5);
      for (const button of [down, up]) {
        expect(button.y).toBeLessThan(text.y + text.height);
        expect(button.y + button.height).toBeGreaterThan(text.y);
        expect(Math.min(button.width, button.height)).toBeGreaterThanOrEqual(TOUCH);
      }

      await panel.up(COUNT).click();
      await expect(field).toHaveValue("8");
      await expect.poll(async () => vault.read(BOOK)).toContain(`${COUNT}: 8`);
      await panel.down(COUNT).click();
      await expect(field).toHaveValue("7");
      await expect.poll(async () => vault.read(BOOK)).toContain(`${COUNT}: 7`);
    } finally {
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} with no fonts in the vault the font list is the face orca carries and a line that names fonts/, and with fonts there the line is gone`, async ({
    obsidian,
    book,
    panel,
    vault,
  }) => {
    vault.touch(BOOK);
    // The index is read once in a window's life, so the folder moves
    // before the window loads.
    await vault.away(FONTS);
    await obsidian.mobile(device);
    try {
      await book.open();
      await book.settled(BOOK);
      await panel.open();
      await panel.pick();
      expect(await panel.offered()).toEqual([CARRIED]);
      await expect(panel.builtIn).toHaveText("built in");
      await expect(panel.noFonts).toContainText(`Add font files to ${FONTS}/ in this vault`);
      await expect(panel.fontsFrom).toHaveCount(0);

      // The engine sets a book in the face it carries, so a book that
      // names it is not told the font is missing.
      await panel.option(CARRIED).click();
      await expect(panel.font).toHaveAttribute("data-default", "false");
      await expect.poll(async () => vault.read(BOOK)).toContain(`body-font: ${CARRIED}`);
      await expect(panel.missing).not.toHaveCount(0);
      await expect(panel.missing.filter({ hasText: CARRIED })).toHaveCount(0);

      // A missing font is an error: the preview lists it under `Fonts`
      // with the warnings, drawn as an error, and counts it apart from
      // them. The panel's header counts it too.
      const missing = await panel.missing.count();
      const count = missing === 1 ? "1 error" : `${String(missing)} errors`;
      await expect(panel.warned).toHaveText(count);
      await expect(book.counted).toHaveText(count);
      await expect(panel.missing.first()).toHaveClass(/mod-error/);
      await expect(panel.missing.first()).toHaveText(/^Missing font: /);
      await expect(panel.fontGroup).toContainText("Fonts");
      await panel.reset("body-font").click();
      await expect(panel.font).toHaveAttribute("data-default", "true");

      await vault.back();
      await obsidian.mobile(device);
      await book.open();
      await book.settled(BOOK);
      await panel.open();
      await panel.pick();
      const offered = await panel.offered();
      expect(offered[0]).toBe(CARRIED);
      expect(offered).toContain(FIXTURE_FONT);
      await expect(panel.builtIn).toHaveCount(1);
      await expect(panel.noFonts).toHaveCount(0);
      await expect(panel.fontsFrom).toHaveText(
        `${String(offered.length)} families, from ${FONTS}/ and orca`,
      );
      await obsidian.page.keyboard.press("Escape");
    } finally {
      // The desktop window that loads next reads the index again, so
      // the folder is back before it does.
      await vault.back();
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} every control in the panel is as large as a touch, and none waits for a pointer to be drawn`, async ({
    obsidian,
    book,
    panel,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.open();
      await book.settled(BOOK);
      await panel.open();
      // The pointer is nowhere near the panel, so a control drawn only
      // under one would not be here.
      await obsidian.page.mouse.move(0, 0);
      await expect(panel.toCss).toBeVisible();
      await expect(panel.reset("trim")).toBeVisible();
      await expect(panel.up("body-size")).toBeVisible();
      await expect(panel.down("body-size")).toBeVisible();
      expect(await panel.cramped()).toEqual([]);
      // The icon in the button that browses the glyphs is in its middle.
      expect(await panel.offCenter(panel.glyphBrowse)).toBeLessThan(1);

      await panel.pick();
      expect(await panel.cramped()).toEqual([]);
      const row = await panel.box(panel.option(FIXTURE_FONT));
      expect(row.height).toBeGreaterThanOrEqual(TOUCH);
      await obsidian.page.keyboard.press("Escape");
    } finally {
      await obsidian.emulateMobile(false);
    }
  });
}

// What this suite does not cover: a lock answering a tap and the card
// it opens, the CSS view by touch and the inspect pane, which are not
// built here; a drawer pinned on a tablet, which the harness cannot
// pin; the row of the carried face drawn in that face, whose bytes are
// the engine's; and a device where Obsidian reads the system's fonts.
