import { PREVIEW } from "./harness/book";
import { DEVICES, TOUCH } from "./harness/obsidian";

/** The view a book note opens in. */
const BOOK_PAGE = "orca-book";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** A chapter of that book, and a section of it. */
const CHAPTER = "Chapter Twelve";
const SECTION = "Body";

/** An entry of that book whose note the vault does not have. */
const MISSING = "Chapter Four";

/** The navigator's own root, which the touch sizes are measured under. */
const ROOT = '[data-testid="orca-navigator"]';

/** The items a chapter's menu holds on mobile, in the order it lists them. */
const ITEMS = [
  "Open as markdown",
  "Open preview",
  "New chapter here",
  "Role for this entry…",
  "Reveal the note",
  "Remove from book",
];

for (const device of ["phone", "tablet"] as const) {
  const shape = device === "phone" ? "as a sheet" : "beside the row";

  test(`on a ${device} a long press on a row opens its menu ${shape}, and \`Open as markdown\` opens the chapter's note`, async ({
    book,
    navigator,
    obsidian,
  }) => {
    await obsidian.mobile(device);
    try {
      await navigator.reveal();
      const row = navigator.entry(BOOK, CHAPTER);
      await navigator.press(row);

      const menu = await navigator.menuBox();
      const at = await row.boundingBox();
      if (at === null) throw new Error("the row has no box");
      for (const item of ITEMS) await expect(obsidian.item(item)).toHaveCount(1);
      if (device === "phone") {
        // The sheet is the width of the screen and stands on its foot.
        expect(menu.x).toBe(0);
        expect(menu.width).toBe(DEVICES.phone.width);
        expect(Math.round(menu.y + menu.height)).toBe(DEVICES.phone.height);
        // The row's name is over the first item.
        const title = await obsidian.item(CHAPTER).boundingBox();
        const first = await obsidian.item(ITEMS[0] ?? "").boundingBox();
        expect(title?.y).toBeLessThan(first?.y ?? 0);
      } else {
        // The menu starts where the row ends, level with it.
        expect(Math.abs(menu.x - (at.x + at.width))).toBeLessThanOrEqual(4);
        expect(menu.y).toBeGreaterThanOrEqual(at.y);
        expect(menu.y).toBeLessThan(at.y + at.height);
        await expect(obsidian.item(CHAPTER)).toHaveCount(0);
      }

      await obsidian.choose("Open as markdown");
      await expect
        .poll(async () =>
          obsidian.page.evaluate(() => {
            const view = window.app.workspace.getMostRecentLeaf()?.view;
            const file = (view as { file?: { path: string } | null } | undefined)?.file;
            return `${view?.getViewType()}:${file?.path}`;
          }),
        )
        .toBe(`markdown:${CHAPTER}.md`);
      await obsidian.detach("markdown");

      await navigator.drawer();
      await navigator.press(row);
      await obsidian.choose("Open preview");
      expect(await book.painted()).toBeGreaterThan(0);
      await obsidian.detach(PREVIEW);

      // A section's menu is the desktop's, and it is how a finger renames one.
      await navigator.drawer();
      await navigator.press(navigator.group(BOOK, SECTION));
      await obsidian.choose("Rename section");
      await expect(navigator.renaming(BOOK)).toBeVisible();
      expect(await obsidian.cramped(ROOT)).toEqual([]);
      await navigator.renaming(BOOK).press("Escape");
      await expect(navigator.renaming(BOOK)).toHaveCount(0);
    } finally {
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} a book's row shows its two actions with no pointer on it, and a missing note shows \`Locate\` and \`Remove\``, async ({
    navigator,
    obsidian,
  }) => {
    await obsidian.mobile(device);
    try {
      await navigator.reveal();
      await obsidian.page.mouse.move(0, 0);
      const name = navigator.name(BOOK);
      await expect(name).not.toBeFocused();
      await expect(navigator.actions(name)).toHaveCSS("opacity", "1");
      await expect(navigator.preview(BOOK)).toBeVisible();
      await expect(name.getByRole("button", { name: "Add to this book" })).toBeVisible();

      const missing = navigator.entry(BOOK, MISSING);
      await expect(missing).toHaveAttribute("data-kind", "missing");
      await expect(navigator.actions(missing)).toHaveCSS("opacity", "1");
      await expect(missing.getByRole("button", { name: "Locate" })).toBeVisible();
      await expect(missing.getByRole("button", { name: "Remove" })).toBeVisible();
    } finally {
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} a tap on a book opens its page and shuts the drawer`, async ({
    navigator,
    obsidian,
  }) => {
    await obsidian.mobile(device);
    try {
      await navigator.drawer();
      await navigator.name(BOOK).locator(".orca-label").click();
      await expect
        .poll(async () =>
          obsidian.page.evaluate(() =>
            window.app.workspace.getMostRecentLeaf()?.view.getViewType(),
          ),
        )
        .toBe(BOOK_PAGE);
      // A drawer that is open and draws nothing says it is not shut, so
      // both are read.
      await expect(navigator.pane).toBeHidden();
      expect(await obsidian.collapsed("left")).toBe(true);
      await obsidian.detach(BOOK_PAGE);
    } finally {
      await obsidian.emulateMobile(false);
    }
  });

  test(`on a ${device} the navigator's rows are a touch tall, its buttons are ${device === "phone" ? "under" : "over"} the list, and nothing in it is smaller than a touch or has a tooltip`, async ({
    navigator,
    obsidian,
  }) => {
    await obsidian.mobile(device);
    try {
      await navigator.reveal();
      await navigator.painted();

      const rows = [
        navigator.name(BOOK),
        navigator.entry(BOOK, CHAPTER),
        navigator.group(BOOK, SECTION),
      ];
      for (const row of rows) {
        const at = await row.boundingBox();
        expect(at?.height).toBeGreaterThanOrEqual(TOUCH);
      }
      await expect(navigator.entry(BOOK, CHAPTER)).toHaveCSS("font-size", "16px");
      await expect(navigator.pane.getByText("Books", { exact: true })).toBeHidden();

      // `New book` is in the row of buttons Obsidian gives a drawer,
      // under the icon of a book with a plus on it.
      await expect(navigator.button("New book").locator("svg")).toHaveClass(/lucide-book-plus/);
      const button = await navigator.button("New book").boundingBox();
      const first = await navigator.name(BOOK).boundingBox();
      if (button === null || first === null) throw new Error("nothing to measure");
      if (device === "phone") expect(button.y).toBeGreaterThan(first.y + first.height - 1);
      else expect(button.y + button.height).toBeLessThanOrEqual(first.y + 1);

      expect(await obsidian.cramped(ROOT)).toEqual([]);

      // The chevron and the two actions on a book's row are in the
      // middle of its height, and the view scrolls no further than the
      // list.
      const off = await navigator.offMiddle(navigator.name(BOOK));
      expect(off).toHaveLength(3);
      for (const each of off) expect(each).toBeLessThan(1);
      expect(await navigator.slack()).toBeLessThanOrEqual(0);

      // `Collapse all` is there with no heading listed, and folds the
      // book. The buttons are where they were, to the pixel, and on a
      // phone that is the foot of the drawer.
      await navigator.button("Collapse all").click();
      await expect(navigator.entry(BOOK, CHAPTER)).toHaveCount(0);
      const folded = await navigator.button("New book").boundingBox();
      expect(folded?.y).toBe(button.y);
      if (device === "phone") expect(button.y).toBeGreaterThan(DEVICES.phone.height / 2);
      expect(await navigator.slack()).toBeLessThanOrEqual(0);
      await navigator.button("Expand all").click();
      await expect(navigator.entry(BOOK, CHAPTER)).toHaveCount(1);

      // The buttons are one row, centered in the pane as the file
      // explorer's are, and none of them is left out.
      const left = await navigator.button("New book").boundingBox();
      const right = await navigator.button("Export").boundingBox();
      const pane = await navigator.pane.boundingBox();
      if (left === null || right === null || pane === null) throw new Error("nothing to measure");
      const middle = (left.x + right.x + right.width) / 2;
      expect(Math.abs(middle - (pane.x + pane.width / 2))).toBeLessThanOrEqual(2);
      for (const label of ["New book", "Search books", "Sort books", "Export"]) {
        await expect(navigator.button(label)).toHaveCount(1);
      }

      if (device === "phone") {
        // The bar is at the foot of the pane, above the pane picker, and
        // the native fade is painted over the list above it.
        const picker = await obsidian.page
          .locator(".workspace-drawer-tab-options")
          .first()
          .boundingBox();
        if (picker === null) throw new Error("no pane picker");
        const bar = await navigator.button("Export").boundingBox();
        expect(bar?.y ?? 0).toBeLessThan(picker.y);
        expect(picker.y - (bar?.y ?? 0) - (bar?.height ?? 0)).toBeLessThan(TOUCH);
        const fade = await navigator.toolbar.evaluate(
          (row) => getComputedStyle(row, "::after").backgroundImage,
        );
        expect(fade).toContain("gradient");
      }

      // Search filters the shelf by name, sort lists the books, and
      // Export with no book open says so.
      await navigator.button("Search books").click();
      await navigator.pane.getByTestId("orca-nav-search").fill("no such chapter");
      await expect(navigator.pane.getByText("No matches")).toBeVisible();
      await navigator.pane.getByTestId("orca-nav-search").fill(CHAPTER);
      await expect(navigator.entry(BOOK, CHAPTER)).toHaveCount(1);
      await navigator.button("Search books").click();
      await navigator.button("Sort books").click();
      await expect(obsidian.item("Name (Z to A)")).toHaveCount(1);
      await obsidian.item("Name (A to Z)").click();
      await expect(navigator.button("Sort books")).toHaveClass(/is-active/);
      await navigator.button("Sort books").click();
      await obsidian.item("Vault order").click();
      await expect(navigator.button("Sort books")).not.toHaveClass(/is-active/);

      // No row cuts its words short, so none has words to put in a tooltip.
      const cut = await navigator.pane.locator(".orca-label").evaluateAll(
        (labels) =>
          labels
            .filter((label) => label.scrollWidth > label.clientWidth)
            .map((label) => label.textContent),
      );
      expect(cut).toEqual([]);
      await navigator.button("New book").hover();
      await expect(obsidian.tooltip()).toHaveCount(0);
    } finally {
      await obsidian.emulateMobile(false);
    }
  });
}

// What this suite does not cover: the press itself. A finger held on a
// row for the time the system asks is a wait on a clock, so the
// `contextmenu` event the press ends in is sent in its place. Nor does
// it cover a real touch screen, where no pointer hovers at all: the
// tooltip check here reads the page straight after the pointer arrives,
// and a tooltip raised later would pass it. The drag handles and a tap
// on a chapter that closes the drawer are not built here.
