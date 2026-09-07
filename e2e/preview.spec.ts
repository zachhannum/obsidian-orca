import { expect, test } from "./harness/test";

/** The pages the fixture book sets to. */
const PAGES = 13;

/** The words the book opens on, which is its title page. */
const OPENING = "Pride and Prejudice";

/** The page the fixture's one chapter opens on. */
const CHAPTER = 11;

test("the ribbon sets the book and paints its first page", async ({ book }) => {
  await book.open();

  expect(await book.painted()).toBeGreaterThan(0);
  await expect(book.surface).toHaveAttribute("data-first", "1");
  await expect(book.page).toContainText(OPENING);

  const stages = await book.stages();
  for (const [stage, runs] of Object.entries(stages)) {
    expect(runs, stage).toBeGreaterThan(0);
  }
});

test("the status reads the page being read out of the book's own length", async ({
  book,
}) => {
  await book.open();
  await book.painted();

  await expect(book.status).toHaveText(`page 1 of ${String(PAGES)}`);
  await expect(book.folio).toHaveValue("1");
  await expect(book.surface).toHaveAttribute("data-pages", String(PAGES));
  // There is no page before the first one.
  await expect(book.previous).toBeDisabled();
});

test("next and previous turn the page, and stop at either end of the book", async ({
  book,
}) => {
  await book.open();
  await book.painted();

  await book.next.click();
  await expect(book.surface).toHaveAttribute("data-first", "2");
  await expect(book.status).toHaveText(`page 2 of ${String(PAGES)}`);

  await book.previous.click();
  await expect(book.surface).toHaveAttribute("data-first", "1");
  await expect(book.previous).toBeDisabled();

  // There is no page after the last one.
  await book.type(String(PAGES));
  await expect(book.next).toBeDisabled();
});

test("a typed folio turns to that page, and one past the end reads the last", async ({
  book,
}) => {
  await book.open();
  await book.painted();

  await book.type(String(PAGES));
  await expect(book.surface).toHaveAttribute("data-first", String(PAGES));

  // A folio past the end of the book reads its last page rather than
  // nothing.
  await book.type("999");
  await expect(book.surface).toHaveAttribute("data-first", String(PAGES));
  await expect(book.folio).toHaveValue(String(PAGES));
});

test("page down, page up, end and home turn the page from the keyboard", async ({
  book,
}) => {
  await book.open();
  await book.painted();

  await book.press("PageDown");
  await expect(book.surface).toHaveAttribute("data-first", "2");

  await book.press("PageUp");
  await expect(book.surface).toHaveAttribute("data-first", "1");

  await book.press("End");
  await expect(book.surface).toHaveAttribute("data-first", String(PAGES));

  await book.press("Home");
  await expect(book.surface).toHaveAttribute("data-first", "1");
});

test("the folio leaves the status bar with the leaf that was reading", async ({
  book,
}) => {
  await book.open();
  await book.painted();
  await expect(book.status).toHaveText(`page 1 of ${String(PAGES)}`);

  await book.close();

  await expect(book.status).toHaveCount(0);
});

test("the page matches the one checked in beside the spec", async ({ book }) => {
  await book.open();
  await book.painted();

  // The book opens on its title page, which is two lines. The chapter
  // is a page of set text, and that is the one worth photographing.
  await book.type(String(CHAPTER));
  await expect(book.surface).toHaveAttribute("data-first", String(CHAPTER));

  await book.pose();
  await expect(book.page).toHaveScreenshot("chapter-page.png");
  await book.stand();
});

test("the switcher reads the book in single, spread and grid", async ({
  book,
}) => {
  await book.open();
  await book.painted();
  await expect(book.surface).toHaveAttribute("data-view", "single");
  await expect(book.surface).toHaveAttribute("data-count", "1");

  await book.show("Spread", "spread");
  await book.show("Grid", "grid");
  await book.show("Single page", "single");
  await expect(book.sheets).toHaveCount(1);
});

test("the spread seats a recto right of the spine and a verso left of it", async ({
  book,
}) => {
  await book.open();
  await book.painted();

  await book.show("Spread", "spread");

  // Page 1 is a recto, so it faces nothing and the slot beside it is
  // left empty rather than the page sliding across the spine. Mirrored
  // margins only read correctly with each page on its own side.
  await expect(book.sheets).toHaveCount(2);
  await expect(book.seat(0)).toHaveAttribute("data-empty", "true");
  await expect(book.seat(1)).toHaveAttribute("data-page", "1");
  await expect(book.seat(1)).toHaveAttribute("data-side", "recto");

  await book.next.click();
  await expect(book.surface).toHaveAttribute("data-first", "2");
  await expect(book.seat(0)).toHaveAttribute("data-page", "2");
  await expect(book.seat(0)).toHaveAttribute("data-side", "verso");
});

test("the grid shows a screenful, and asks for exactly the pages it paints", async ({
  book,
}) => {
  await book.open();
  await book.painted();

  await book.show("Grid", "grid");

  // The grid asks for as many pages as the well fits, and paints those
  // and no others.
  const shown = await book.showing();
  expect(shown).toBeGreaterThan(1);
  expect(shown).toBeLessThanOrEqual(PAGES);
  await expect(book.sheets).toHaveCount(shown);
  await expect(book.status).toHaveText(
    `pages 1\u2013${String(shown)} of ${String(PAGES)}`,
  );
});

test("copy off a page returns the text in reading order", async ({
  book,
  obsidian,
}) => {
  await book.open();
  await book.painted();

  const copied = await obsidian.page.evaluate(() => {
    const surface = document.querySelector("[data-testid='orca-sheets']");
    const lines = [
      ...(surface?.querySelectorAll("text[data-selection-line]") ?? []),
    ].slice(0, 3);
    const first = lines[0]?.firstChild;
    const last = lines.at(-1);
    if (!first || !last?.firstChild) return null;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last.firstChild, (last.textContent ?? "").length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const event = new ClipboardEvent("copy", {
      bubbles: true,
      clipboardData: new DataTransfer(),
    });
    surface?.dispatchEvent(event);
    const text = event.clipboardData?.getData("text/plain") ?? null;
    selection?.removeAllRanges();
    return { text, set: lines.map((line) => line.textContent).join("\n") };
  });

  // A page is paths, so what comes back is the painter's own layer:
  // the lines the drag covered, in the order they are set.
  expect(copied?.text).toBe(copied?.set);
  expect(copied?.text).toContain(OPENING);
});

test("a screen reader reads a page: it is named, and the glyphs stay out of the tree", async ({
  book,
  obsidian,
}) => {
  await book.open();
  await book.painted();

  await expect(obsidian.page.getByRole("group", { name: "Page 1" })).toHaveCount(
    1,
  );
  // The painter's selection layer is the manuscript's own text, so it
  // is what is read; the drawn glyphs are the same words shaped, and
  // reading them too would read the page twice.
  await expect(
    book.page.locator("text[data-selection-line]").first(),
  ).not.toHaveAttribute("aria-hidden", "true");
  await expect(
    book.page.locator("text:not([data-selection-line])").first(),
  ).toHaveAttribute("aria-hidden", "true");
});
