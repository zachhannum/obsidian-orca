import { PREVIEW, PREVIEW_CONTROLS } from "./harness/book";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The place each device draws the EPUB view's controls: the pane's foot or its bar. */
const PLACE = { phone: "under", tablet: "bar" } as const;

/** The test ids of the controls the view puts on the bar or the foot. */
const CONTROLS = [
  "orca-reflow-settings",
  "orca-reflow-device",
  "orca-reflow-previous",
  "orca-reflow-next",
];

for (const device of ["phone", "tablet"] as const) {
  test(`the EPUB view's controls are ${device === "phone" ? "under the page" : "in the preview's bar"} on a ${device}, each the size of a touch`, async ({
    obsidian,
    book,
    epub,
  }) => {
    await obsidian.mobile(device);
    try {
      await book.close();
      await book.open();
      await book.settled(BOOK);
      await book.uncovered();
      await epub.open();

      const place = await book.footed(PLACE[device]);
      for (const id of CONTROLS) {
        await expect(place.getByTestId(id)).toHaveCount(1);
        await expect(place.getByTestId(id)).toBeVisible();
      }
      expect(await obsidian.cramped(PREVIEW_CONTROLS)).toEqual([]);
      // The device is scaled into the pane, never wider than it.
      const pane = await obsidian.view(PREVIEW).boundingBox();
      const body = await epub.body.boundingBox();
      expect(body?.width).toBeLessThanOrEqual((pane?.width ?? 0) + 0.5);
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });
}

test("on a phone the reader settings open above their button, inside the pane", async ({
  obsidian,
  book,
  epub,
}) => {
  await obsidian.mobile("phone");
  try {
    await book.close();
    await book.open();
    await book.settled(BOOK);
    await book.uncovered();
    await epub.open();
    await book.footed("under");

    await epub.settings.click();
    const sheet = obsidian.view(PREVIEW).getByTestId("orca-reflow-popover");
    await expect(sheet).toBeVisible();
    const opened = await sheet.boundingBox();
    const button = await epub.settings.boundingBox();
    const pane = await obsidian.view(PREVIEW).boundingBox();
    expect(opened).not.toBeNull();
    expect((opened?.y ?? 0) + (opened?.height ?? 0)).toBeLessThanOrEqual(button?.y ?? 0);
    expect(opened?.x ?? -1).toBeGreaterThanOrEqual(pane?.x ?? 0);
    expect((opened?.x ?? 0) + (opened?.width ?? 0)).toBeLessThanOrEqual(
      (pane?.x ?? 0) + (pane?.width ?? 0) + 0.5,
    );

    await epub.settings.click();
    await expect(sheet).toHaveCount(0);
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("a phone on its side has the EPUB view's controls in the bar", async ({
  obsidian,
  book,
  epub,
}) => {
  await obsidian.mobile("phone");
  try {
    await book.close();
    await book.open();
    await book.settled(BOOK);
    await book.uncovered();
    await epub.open();
    await book.footed("under");

    await obsidian.turn();
    const bar = await book.footed("bar");
    for (const id of CONTROLS) await expect(bar.getByTestId(id)).toBeVisible();
    await expect(book.exportIn).toBeVisible();
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

// What this suite does not cover: a swipe, which Playwright cannot send
// into a sandboxed frame over CDP, so `swipeOf` is held in the Node
// tier alone; the camera and home bar of a real phone, which emulation
// draws at nothing; and the EPUB view in a tablet's pane under 700px.
