import { expect, test } from "./harness/test";

/** The pages the fixture chapter sets to. */
const PAGES = 2;

test("the ribbon sets the book and paints its first page", async ({ book }) => {
  await book.open();

  expect(await book.painted()).toBeGreaterThan(0);
  await expect(book.page).toHaveAttribute("data-page", "1");
  await expect(book.page).toContainText("In consequence of an agreement");

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
  await expect(book.surface).toHaveAttribute("data-page", String(PAGES));
  await expect(book.status).toHaveText(`page ${String(PAGES)} of ${String(PAGES)}`);
  await expect(book.next).toBeDisabled();

  await book.previous.click();
  await expect(book.surface).toHaveAttribute("data-page", "1");
  await expect(book.previous).toBeDisabled();
});

test("a typed folio turns to that page, and one past the end reads the last", async ({
  book,
}) => {
  await book.open();
  await book.painted();

  await book.type(String(PAGES));
  await expect(book.surface).toHaveAttribute("data-page", String(PAGES));

  // A folio past the end of the book reads its last page rather than
  // nothing.
  await book.type("999");
  await expect(book.surface).toHaveAttribute("data-page", String(PAGES));
  await expect(book.folio).toHaveValue(String(PAGES));
});

test("page down, page up, end and home turn the page from the keyboard", async ({
  book,
}) => {
  await book.open();
  await book.painted();

  await book.press("PageDown");
  await expect(book.surface).toHaveAttribute("data-page", String(PAGES));

  await book.press("PageUp");
  await expect(book.surface).toHaveAttribute("data-page", "1");

  await book.press("End");
  await expect(book.surface).toHaveAttribute("data-page", String(PAGES));

  await book.press("Home");
  await expect(book.surface).toHaveAttribute("data-page", "1");
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

test("the page matches the one checked in beside the spec", async ({
  book,
  obsidian,
}) => {
  await book.open();
  await book.painted();

  // The page is as tall as the pane leaves it, so it lands on fractions
  // of a pixel, and a runner that lays the pane out a hair differently
  // rasterizes every glyph differently. The photograph is taken at one
  // size on whole pixels, near enough where the page already stands to
  // stay clear of the chrome. Where it stands is what the assertions
  // above are for.
  await obsidian.page.evaluate(() => {
    const page = document.querySelector(".orca-page");
    if (page === null) return;
    const box = page.getBoundingClientRect();
    const pin = document.createElement("style");
    pin.id = "orca-photograph";
    pin.textContent =
      ".orca-page { position: fixed; width: 360px; height: 540px;" +
      ` top: ${String(Math.floor(box.top))}px;` +
      ` left: ${String(Math.floor(box.left))}px }`;
    document.head.append(pin);
  });

  await expect(book.page).toHaveScreenshot("page-one.png");

  await obsidian.page.evaluate(() => {
    document.getElementById("orca-photograph")?.remove();
  });
});
