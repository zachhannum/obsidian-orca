import { PREVIEW, PREVIEW_CONTROLS } from "./harness/book";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The place each device draws the EPUB view's controls: the pane's foot or its bar. */
const PLACE = { phone: "under", tablet: "bar" } as const;

/** Lists each pair of visible children of a node whose boxes overlap, and each that reaches past the node. */
function overlapping(node: HTMLElement): string[] {
  const boxes = Array.from(node.children)
    .filter((child) => child.checkVisibility())
    .map((child) => ({ name: child.getAttribute("data-testid") ?? child.className, box: child.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 0 && box.height > 0);
  const found: string[] = [];
  const outer = node.getBoundingClientRect();
  for (const { name, box } of boxes) {
    if (box.left < outer.left - 1 || box.right > outer.right + 1) found.push(`${name} outside`);
  }
  boxes.forEach((a, i) => {
    for (const b of boxes.slice(i + 1)) {
      const across = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const down = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (across > 1 && down > 1) found.push(`${a.name} over ${b.name}`);
    }
  });
  return found;
}

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
      // The page views' folio and arrows give way to the view's own.
      await expect(obsidian.view(PREVIEW).locator(".orca-preview-paging:visible")).toHaveCount(0);
      // Nothing in the foot or the bar draws over its neighbour.
      expect(await place.evaluate(overlapping)).toEqual([]);
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

test("a touch swipe in the frame turns a screen", async ({ obsidian, book, epub }) => {
  await obsidian.mobile("phone");
  try {
    await book.close();
    await book.open();
    await book.settled(BOOK);
    await book.uncovered();
    await epub.open();
    const before = await epub.turned();

    const box = await epub.frame.boundingBox();
    if (box === null) throw new Error("the frame has no box");
    const y = box.y + box.height / 2;
    const from = box.x + box.width * 0.8;
    const to = box.x + box.width * 0.2;
    const page = obsidian.view(PREVIEW).page();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number): Promise<unknown> =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    await touch("touchStart", from);
    for (let step = 1; step <= 6; step++) {
      await touch("touchMove", from + ((to - from) * step) / 6);
    }
    await touch("touchEnd", to);

    // A section of one screen turns to the next section.
    await expect
      .poll(async () => {
        const to = await epub.turned();
        return to.section !== before.section || to.screen !== before.screen;
      })
      .toBe(true);
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

// What this suite does not cover: a swipe on a real device, which
// emulation stands in for with dispatched touches; the camera and home bar of a real phone, which emulation
// draws at nothing; and the EPUB view in a tablet's pane under 700px.
