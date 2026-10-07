import { expect, test } from "./harness/test";

/** A page of prose, which sets one line under the next. */
const PROSE = 11;

/** The zooms the first two steps in stop at, as percentages. */
const STEPS = [125, 150] as const;

test("the keys zoom in, zoom out and fit, and the bar reads the zoom as a percentage", async ({
  book,
}) => {
  await book.open();
  await book.painted();
  await book.zoomed(100);
  await expect(book.zoomPercent).toHaveText("100%");
  const fitted = await book.room(0);

  await book.press("ControlOrMeta+=");
  await book.zoomed(STEPS[0]);
  await expect(book.zoomPercent).toHaveText(`${String(STEPS[0])}%`);
  await book.key("ControlOrMeta+=");
  await book.zoomed(STEPS[1]);
  await book.key("ControlOrMeta+-");
  await book.zoomed(STEPS[0]);

  // The well is the room it was, and the sheet in it is a quarter larger.
  const closer = await book.room(0);
  expect(closer.well).toEqual(fitted.well);
  expect(closer.sheet.width).toBeCloseTo(fitted.sheet.width * 1.25, 0);
  expect(closer.sheet.height).toBeCloseTo(fitted.sheet.height * 1.25, 0);

  await book.key("ControlOrMeta+0");
  await book.zoomed(100);
  expect(await book.room(0)).toEqual(fitted);
});

test("the commands zoom the preview as the keys do", async ({ book, obsidian }) => {
  await book.open();
  await book.painted();
  await book.zoomed(100);

  await obsidian.command("orca:zoom-in");
  await book.zoomed(STEPS[0]);
  await obsidian.command("orca:zoom-in");
  await book.zoomed(STEPS[1]);
  await obsidian.command("orca:zoom-out");
  await book.zoomed(STEPS[0]);
  await obsidian.command("orca:zoom-fit");
  await book.zoomed(100);
});

test("the control steps the zoom, and a click on the percentage fits the page to the pane", async ({
  book,
}) => {
  await book.open();
  await book.painted();
  const fitted = await book.room(0);
  await expect(book.zoomOut).toBeDisabled();

  await book.zoomIn.click();
  await book.zoomed(STEPS[0]);
  await book.zoomIn.click();
  await book.zoomed(STEPS[1]);
  await book.zoomOut.click();
  await book.zoomed(STEPS[0]);

  await book.zoomPercent.click();
  await book.zoomed(100);
  expect(await book.room(0)).toEqual(fitted);
});

test("a zoomed page is laid out at the zoomed size, with no transform over it", async ({ book }) => {
  await book.open();
  await book.painted();
  const fitted = await book.drawn();

  await book.zoomIn.click();
  await book.zoomIn.click();
  await book.zoomed(STEPS[1]);

  const closer = await book.drawn();
  expect(closer.scaled).toBe(false);
  expect(closer.width).toBeCloseTo(fitted.width * 1.5, 0);

  await book.zoomPercent.click();
  await book.zoomed(100);
});

test("the wheel with Ctrl held zooms about the pointer", async ({ book, obsidian }) => {
  await book.open();
  await book.painted();
  await book.turnTo(PROSE);

  // The page is narrower than the well, so it stays centered across,
  // and the pointer is put on the line the zoom is to keep.
  const sheet = await book.seat(0).boundingBox();
  const line = await book.lines().nth(4).boundingBox();
  if (sheet === null || line === null) throw new Error("no page is on screen");
  const pointer = { x: sheet.x + sheet.width / 2, y: line.y + line.height / 2 };
  const before = await book.share(pointer);

  const { mouse, keyboard } = obsidian.page;
  await mouse.move(pointer.x, pointer.y);
  await keyboard.down("Control");
  try {
    await mouse.wheel(0, -300);
    await expect.poll(async () => book.zoom()).toBeGreaterThan(150);
  } finally {
    await keyboard.up("Control");
  }

  const after = await book.share(pointer);
  expect(after.x).toBeCloseTo(before.x, 2);
  expect(after.y).toBeCloseTo(before.y, 2);

  await book.zoomPercent.click();
  await book.zoomed(100);
});

test("a turn keeps the zoom and shows the page from its top", async ({ book }) => {
  await book.open();
  await book.painted();
  await book.turnTo(PROSE);
  await book.zoomIn.click();
  await book.zoomIn.click();
  await book.zoomed(STEPS[1]);
  // The zoom holds the middle of the page, so the page is scrolled down.
  await expect(book.surface).not.toHaveAttribute("data-pan", /,0$/);

  await book.next.click();
  await expect(book.surface).toHaveAttribute("data-first", String(PROSE + 1));
  await book.zoomed(STEPS[1]);
  await expect(book.surface).toHaveAttribute("data-pan", /,0$/);

  await book.zoomPercent.click();
  await book.zoomed(100);
});

test("the grid does not zoom: it draws no control, and a zoomed page goes back to fit for it", async ({
  book,
}) => {
  await book.open();
  await book.painted();
  await book.zoomIn.click();
  await book.zoomed(STEPS[0]);

  await book.show("Grid", "grid");
  await book.zoomed(100);
  await expect(book.zoomIn).toHaveCount(0);
  await expect(book.zoomPercent).toHaveCount(0);

  await book.show("Spread", "spread");
  await expect(book.zoomPercent).toHaveText("100%");
  await book.zoomIn.click();
  await book.zoomed(STEPS[0]);

  await book.zoomPercent.click();
  await book.zoomed(100);
  await book.show("Single page", "single");
});

test("a drag across a zoomed page selects the set lines, and copy returns them", async ({ book }) => {
  await book.open();
  await book.painted();
  await book.turnTo(PROSE);
  await book.zoomIn.click();
  await book.zoomIn.click();
  await book.zoomed(STEPS[1]);

  const lines = book.seat(0).locator("text[data-selection-line]");
  const set = (await lines.allTextContents()).slice(4, 7);
  await book.drag(lines.nth(4), lines.nth(6));

  const selected = await book.selected();
  expect(selected.onLines).toBe(true);
  expect(selected.copied).toBe(set.join("\n"));

  await book.zoomPercent.click();
  await book.zoomed(100);
});

test("a drag with Space held moves a zoomed page, and selects no text", async ({ book, obsidian }) => {
  await book.open();
  await book.painted();
  await book.turnTo(PROSE);
  await book.zoomIn.click();
  await book.zoomIn.click();
  await book.zoomed(STEPS[1]);

  const well = await book.surface.boundingBox();
  if (well === null) throw new Error("no page is on screen");
  const from = { x: well.x + well.width / 2, y: well.y + well.height / 2 };
  const pan = async (): Promise<number[]> =>
    ((await book.surface.getAttribute("data-pan")) ?? "").split(",").map(Number);
  const [, top = 0] = await pan();

  const { mouse, keyboard } = obsidian.page;
  // A click puts the focus on the pages, as a reader's does.
  await mouse.click(from.x, from.y);
  await keyboard.down("Space");
  try {
    await expect(book.surface).toHaveClass(/is-hand/);
    await mouse.down();
    await mouse.move(from.x, from.y - 60, { steps: 6 });
    await mouse.up();
    // The page follows the pointer, so a drag up scrolls it down.
    await expect(book.surface).toHaveAttribute("data-pan", new RegExp(`,${String(top + 60)}$`));
  } finally {
    await keyboard.up("Space");
  }
  await expect(book.surface).not.toHaveClass(/is-hand/);
  expect((await book.selected()).text).toBe("");
  // The key made the focus visible, and the well draws no ring for it.
  await expect(book.surface.locator("xpath=..")).toBeFocused();
  await expect(book.surface.locator("xpath=..")).toHaveCSS("box-shadow", "none");

  // With the key up, the same drag selects the lines it covers.
  const lines = book.seat(0).locator("text[data-selection-line]");
  await lines.nth(8).scrollIntoViewIfNeeded();
  await book.drag(lines.nth(8), lines.nth(9));
  expect((await book.selected()).onLines).toBe(true);

  await book.zoomPercent.click();
  await book.zoomed(100);
  // Space at fit takes no hand.
  await mouse.move(from.x, from.y);
  await keyboard.down("Space");
  await keyboard.up("Space");
  await expect(book.surface).not.toHaveClass(/is-hand/);
});

// What this suite does not cover: a pinch on a real trackpad, which
// Chromium sends as the wheel this suite sends. The window's own zoom
// on the same keys, where the preview does not have the focus. How
// sharp the type is, which is the browser's to rasterize: the suite
// checks that the page is laid out at the zoomed size and nothing
// scales it. A link on a zoomed page is followed in `links.spec.ts`,
// and a pinch on a touch screen is in `mobile-preview.spec.ts`.
