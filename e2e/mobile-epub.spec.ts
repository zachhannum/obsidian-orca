import { PREVIEW, PREVIEW_CONTROLS } from "./harness/book";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The place each device draws the EPUB view's controls: the pane's foot or its bar. */
const PLACE = { phone: "under", tablet: "bar" } as const;

/** The note the last section is read from, and the image it embeds. */
const LAST_NOTE = "Acknowledgements.md";
const DEVICE = "![[device.png]]";

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
      // The device is centred across the well, and down the room the status line leaves.
      const well = await obsidian.view(PREVIEW).locator(".orca-preview-well").boundingBox();
      const room = await obsidian.view(PREVIEW).locator(".orca-reflow-room").boundingBox();
      if (well === null || body === null || room === null) throw new Error("a box is missing");
      expect(Math.abs(body.x + body.width / 2 - (well.x + well.width / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(body.y + body.height / 2 - (room.y + room.height / 2))).toBeLessThanOrEqual(1);
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });
}

for (const device of ["phone", "tablet"] as const) {
  test(`on a ${device} the EPUB view draws the count of warnings ${device === "phone" ? "as an icon and a number under the page" : "in words in the bar"}, and a tap on it opens them`, async ({
    obsidian,
    book,
    epub,
    vault,
  }) => {
    await obsidian.mobile(device);
    // The narrowest phone orca is drawn for, so the foot is held to
    // the least room it gets.
    if (device === "phone") await obsidian.size(360, 780);
    try {
      await book.close();
      vault.touch(LAST_NOTE);
      await book.open();
      const painted = await book.settled(BOOK);
      await book.uncovered();
      const note = await vault.read(LAST_NOTE);
      await vault.modify(LAST_NOTE, note.replace(DEVICE, "![[nothing here.png]]"));
      await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
      await epub.open();

      const place = await book.footed(PLACE[device]);
      const count = place.getByTestId("orca-warnings");
      await expect(count).toBeVisible();
      const said = await count.getAttribute("aria-label");
      expect(said).toMatch(/^(\d+ errors?, )?\d+ warnings?$/);
      await expect(count).toHaveAttribute("title", said ?? "");
      const words = count.locator(".orca-preview-said");
      const alert = count.locator(".orca-preview-alert");
      if (device === "phone") {
        // Under the page the count is an icon and the total, one touch
        // wide, and its label spells it out.
        await expect(words).toBeHidden();
        await expect(alert).toBeVisible();
        await expect(alert.locator("svg")).toBeVisible();
        const total = (said ?? "").match(/\d+/g)?.reduce((sum, n) => sum + Number(n), 0);
        expect(
          await alert.evaluate((node) => getComputedStyle(node, "::after").content),
        ).toBe(`"${String(total)}"`);
        const box = await count.boundingBox();
        const touch = await count.evaluate((node) =>
          Number.parseFloat(getComputedStyle(node).getPropertyValue("--touch-size-m")),
        );
        expect(Math.abs((box?.width ?? 0) - touch)).toBeLessThanOrEqual(0.5);
      } else {
        // In the bar the count keeps its words.
        await expect(words).toBeVisible();
        await expect(words).toHaveText(said ?? "");
        await expect(alert).toBeHidden();
      }
      for (const id of CONTROLS) await expect(place.getByTestId(id)).toBeVisible();
      // The count draws over none of the controls, and nothing reaches
      // past the foot or the bar.
      expect(await place.evaluate(overlapping)).toEqual([]);
      expect(await place.locator(".orca-reflow-controls").evaluate(overlapping)).toEqual([]);
      expect(await obsidian.cramped(PREVIEW_CONTROLS)).toEqual([]);
      // The count is at the left of the controls, and the last of them
      // is still inside the pane.
      const chip = await count.boundingBox();
      const settings = await place.getByTestId("orca-reflow-settings").boundingBox();
      const next = await place.getByTestId("orca-reflow-next").boundingBox();
      const pane = await obsidian.view(PREVIEW).boundingBox();
      if (chip === null || settings === null || next === null || pane === null) {
        throw new Error("a box is missing");
      }
      expect(chip.x).toBeGreaterThanOrEqual(pane.x - 0.5);
      expect(chip.x + chip.width).toBeLessThanOrEqual(settings.x + 1);
      expect(next.x + next.width).toBeLessThanOrEqual(pane.x + pane.width + 0.5);

      await count.click();
      await expect(count).toHaveAttribute("aria-expanded", "true");
      await expect(book.issues.first()).toBeVisible();
      // The warnings are drawn over the EPUB view, not under it.
      expect(
        await book.issues.first().evaluate((issue) => {
          const box = issue.getBoundingClientRect();
          const top = issue.ownerDocument.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return top !== null && issue.contains(top);
        }),
      ).toBe(true);

      await count.click();
      await expect(count).toHaveAttribute("aria-expanded", "false");
      await expect(book.issues.first()).toBeHidden();
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });
}

for (const device of ["phone", "tablet"] as const) {
  test(`on a ${device} the reader settings are drawn over the device, opaque`, async ({
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
      await book.footed(PLACE[device]);

      await epub.settings.click();
      const sheet = obsidian.view(PREVIEW).getByTestId("orca-reflow-popover");
      await expect(sheet).toBeVisible();
      await expect(sheet).not.toHaveAttribute("style", /visibility: hidden/);
      // At the middle of each row is the sheet itself, not the device
      // or the page inside it.
      const missed = await sheet.evaluate((node) =>
        Array.from(node.children)
          .map((row) => row.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0)
          .map((box) => node.ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
          .filter((top) => top === null || !node.contains(top))
          .map((top) => (top === null ? "nothing" : top.className || top.tagName)),
      );
      expect(missed).toEqual([]);
      const painted = await sheet.evaluate((node) => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, shadow: style.boxShadow };
      });
      expect(painted.background).toMatch(/^rgb\(/);
      expect(painted.shadow).not.toBe("none");

      await epub.settings.click();
      await expect(sheet).toHaveCount(0);
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
    // On its side the device is still centred across the well.
    const well = await obsidian.view(PREVIEW).locator(".orca-preview-well").boundingBox();
    const body = await epub.body.boundingBox();
    if (well === null || body === null) throw new Error("a box is missing");
    expect(Math.abs(body.x + body.width / 2 - (well.x + well.width / 2))).toBeLessThanOrEqual(1);
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

// What this suite does not cover: a swipe, since the EPUB view has
// none and its arrows and keys turn a screen; the camera and home bar
// of a real phone, which emulation draws at nothing; and the EPUB view
// in a tablet's pane under 700px.
