import { PREVIEW, PREVIEW_CONTROLS } from "./harness/book";
import { boxOf, NEAR } from "./harness/box";
import { DEVICES, SHEET, TOUCH } from "./harness/obsidian";
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

/**
 * Measures the pill the count draws under the page, with `digits` as
 * its number: the button is a touch or more each way, the pill is
 * inside it and in its middle, the pill is round at its ends and
 * tinted, the icon and the number are inside the pill and level with
 * each other, and the button stops short of the settings button.
 */
function pilled(button: HTMLElement, digits: string): Record<string, boolean> | undefined {
  const pill = button.querySelector(".orca-preview-pill");
  const icon = button.querySelector(".orca-preview-alert svg");
  const number = button.querySelector(".orca-preview-number");
  const settings = button.ownerDocument.querySelector('[data-testid="orca-reflow-settings"]');
  if (pill === null || icon === null || number === null || settings === null) return undefined;
  const written = number.textContent;
  number.textContent = digits;
  const touch = Number.parseFloat(getComputedStyle(button).getPropertyValue("--touch-size-m"));
  const outer = button.getBoundingClientRect();
  const drawn = pill.getBoundingClientRect();
  const style = getComputedStyle(pill);
  const within = (box: DOMRect, of: DOMRect): boolean =>
    box.left >= of.left - 0.5 &&
    box.right <= of.right + 0.5 &&
    box.top >= of.top - 0.5 &&
    box.bottom <= of.bottom + 0.5;
  const middle = (box: DOMRect): number => box.top + box.height / 2;
  const glyph = icon.getBoundingClientRect();
  const figure = number.getBoundingClientRect();
  const found = {
    wide: outer.width >= touch - 0.5,
    tall: outer.height >= touch - 0.5,
    inside: within(drawn, outer),
    centred:
      Math.abs(drawn.left + drawn.width / 2 - (outer.left + outer.width / 2)) <= 1 &&
      Math.abs(middle(drawn) - middle(outer)) <= 1,
    round: Number.parseFloat(style.borderTopLeftRadius) >= drawn.height / 2 - 0.5,
    tinted: style.backgroundColor !== "rgba(0, 0, 0, 0)" && pill.scrollWidth <= pill.clientWidth,
    holds: within(glyph, drawn) && within(figure, drawn),
    level: Math.abs(middle(glyph) - middle(figure)) <= 1.5 && Math.abs(middle(glyph) - middle(drawn)) <= 1.5,
    clear: outer.right <= settings.getBoundingClientRect().left + 1,
  };
  number.textContent = written;
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
  test(`on a ${device} the EPUB view draws the count of issues ${device === "phone" ? "as an icon and a number under the page" : "in words in the bar"}, and a tap on it opens them`, async ({
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
      const count = place.getByTestId("orca-issues-count");
      await expect(count).toBeVisible();
      const said = await count.getAttribute("aria-label");
      expect(said).toMatch(/^(\d+ errors?, )?\d+ warnings?$/);
      await expect(count).toHaveAttribute("title", said ?? "");
      const words = count.locator(".orca-preview-said");
      const alert = count.locator(".orca-preview-alert");
      if (device === "phone") {
        // Under the page the count is an icon and the total, in a pill
        // in the middle of a button at least one touch wide and tall.
        await expect(words).toBeHidden();
        await expect(alert).toBeVisible();
        await expect(alert.locator("svg")).toBeVisible();
        const total = (said ?? "").match(/\d+/g)?.reduce((sum, n) => sum + Number(n), 0);
        await expect(alert.locator(".orca-preview-number")).toHaveText(String(total));
        const touch = await count.evaluate((node) =>
          Number.parseFloat(getComputedStyle(node).getPropertyValue("--touch-size-m")),
        );
        for (const digits of [String(total), "12", "128"]) {
          expect(await count.evaluate(pilled, digits), `a count of ${digits}`).toEqual({
            wide: true,
            tall: true,
            inside: true,
            centred: true,
            round: true,
            tinted: true,
            holds: true,
            level: true,
            clear: true,
          });
        }
        const box = await count.boundingBox();
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
      // The warnings are drawn over the EPUB view, not under it. A
      // phone slides them in, so they are read once they are in place.
      await boxOf(book.issues.first());
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

      // A phone's sheet covers the count, and a tap outside it closes it.
      if (device === "phone") {
        await boxOf(book.warnings);
        await obsidian.backdrop("orca-warnings").click({ position: { x: 10, y: 10 } });
      } else await count.click();
      await expect(count).toHaveAttribute("aria-expanded", "false");
      await expect(book.issues.first()).toBeHidden();
    } finally {
      await book.close();
      await obsidian.emulateMobile(false);
    }
  });
}

test("on a tablet the reader settings are drawn over the device, opaque, and in no sheet", async ({
  obsidian,
  book,
  epub,
}) => {
  await obsidian.mobile("tablet");
  try {
    await book.close();
    await book.open();
    await book.settled(BOOK);
    await book.uncovered();
    await epub.open();
    await book.footed(PLACE.tablet);

    await epub.settings.click();
    await expect(epub.controls).toHaveAttribute("data-settings", "popover");
    const hung = obsidian.view(PREVIEW).getByTestId("orca-reflow-popover");
    await expect(hung).toBeVisible();
    await expect(hung).not.toHaveAttribute("style", /visibility: hidden/);
    await expect(obsidian.sheet()).toHaveCount(0);
    // At the middle of each row is the settings' own box, not the
    // device or the page inside it.
    const missed = await hung.evaluate((node) =>
      Array.from(node.children)
        .map((row) => row.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0)
        .map((box) => node.ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
        .filter((top) => top === null || !node.contains(top))
        .map((top) => (top === null ? "nothing" : top.className || top.tagName)),
    );
    expect(missed).toEqual([]);
    const painted = await hung.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, shadow: style.boxShadow };
    });
    expect(painted.background).toMatch(/^rgb\(/);
    expect(painted.shadow).not.toBe("none");

    await epub.settings.click();
    await expect(hung).toHaveCount(0);
    await expect(epub.controls).toHaveAttribute("data-settings", "shut");
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("on a phone the reader settings open as a sheet with nothing dimmed, and the device is whole above it", async ({
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
    const before = await boxOf(epub.body);

    await epub.settings.click();
    await expect(epub.controls).toHaveAttribute("data-settings", "sheet");
    await expect(obsidian.sheet("orca-reader-sheet")).toHaveCount(1);
    await expect(epub.sheet).toContainText("Reader settings");
    const sheet = await boxOf(epub.sheet);
    expect(Math.abs(sheet.width - DEVICES.phone.width)).toBeLessThanOrEqual(NEAR);
    expect(Math.abs(sheet.y + sheet.height - DEVICES.phone.height)).toBeLessThanOrEqual(NEAR);
    expect(
      await obsidian
        .backdrop("orca-reader-sheet")
        .evaluate((bg) => getComputedStyle(bg).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    // The grabber and each row of settings are as tall as a touch.
    const short = await epub.sheet.evaluate(
      (node, least) =>
        Array.from(
          node.querySelectorAll<HTMLElement>('[data-testid="orca-sheet-grabber"], .orca-panel-row'),
        )
          .map((row) => row.getBoundingClientRect().height)
          .filter((height) => height < least - 0.5),
      TOUCH,
    );
    expect(short).toEqual([]);

    // The device is drawn again, smaller, in the room the sheet leaves.
    await expect
      .poll(async () => {
        const body = await epub.body.boundingBox();
        return body === null ? Infinity : body.y + body.height;
      })
      .toBeLessThanOrEqual(sheet.y);
    const above = await boxOf(epub.body);
    expect(above.y).toBeGreaterThanOrEqual(0);
    expect(above.height).toBeGreaterThan(0);
    expect(above.height).toBeLessThan(before.height);
    expect(Math.abs(above.width / above.height - before.width / before.height)).toBeLessThan(0.01);

    // A setting takes effect on the device while the sheet is open.
    await epub.setting("theme-dark").click();
    await expect(epub.screen).toHaveClass(/mod-dark/);
    await expect(epub.controls).toHaveAttribute("data-settings", "sheet");
    await epub.setting("theme-light").click();
    await expect(epub.screen).not.toHaveClass(/mod-dark/);

    await obsidian.backdrop("orca-reader-sheet").click({ position: { x: 10, y: 10 } });
    await expect(epub.controls).toHaveAttribute("data-settings", "shut");
    await expect(epub.sheet).toHaveCount(0);
    await expect
      .poll(async () => (await epub.body.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(before.height - NEAR);

    await epub.settings.click();
    await expect(epub.controls).toHaveAttribute("data-settings", "sheet");
    await boxOf(epub.sheet);
    await epub.grabber.click();
    await expect(epub.controls).toHaveAttribute("data-settings", "shut");
    await expect(epub.sheet).toHaveCount(0);
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("a phone on its side has the EPUB view's controls in the bar, and the reader settings' sheet leaves the page in sight", async ({
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

    // The settings are taller than a phone on its side, so the sheet
    // stops short of the top and its rows scroll inside it.
    await epub.settings.click();
    await expect(epub.controls).toHaveAttribute("data-settings", "sheet");
    const sheet = await boxOf(epub.sheet);
    const tall = DEVICES.phone.width;
    expect(sheet.height).toBeLessThanOrEqual(tall * SHEET + NEAR);
    expect(Math.abs(sheet.y + sheet.height - tall)).toBeLessThanOrEqual(NEAR);
    await epub.setting("theme-dark").scrollIntoViewIfNeeded();
    await expect(epub.setting("theme-dark")).toBeInViewport();
    await epub.grabber.click();
    await expect(epub.controls).toHaveAttribute("data-settings", "shut");
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

test("on a phone a long title is cut short on the status line, and the page and the percentage stay whole", async ({
  obsidian,
  book,
  epub,
}) => {
  await obsidian.mobile("phone");
  await obsidian.size(360, 780);
  try {
    await book.close();
    await book.open();
    await book.settled(BOOK);
    await book.uncovered();
    await epub.open();
    await book.footed("under");

    // The book opens on a document its contents may not list, so the
    // view is turned to the first one that has a title.
    const title = epub.view.getByTestId("orca-reflow-title");
    while ((await title.count()) === 0) await epub.turn();

    const drawn = await epub.status.evaluate((line) => {
      const name = line.querySelector('[data-testid="orca-reflow-title"]');
      const place = line.querySelector('[data-testid="orca-reflow-place"]');
      const words = name?.firstChild;
      if (name === null || place === null || words === null || words === undefined) return undefined;
      const short = line.getBoundingClientRect().height;
      words.nodeValue = "In Which a Title Runs On Far Past the Width of Any Phone ".repeat(3);
      const outer = line.getBoundingClientRect();
      const kept = place.getBoundingClientRect();
      return {
        grew: outer.height - short,
        cut: name.scrollWidth > name.clientWidth,
        ellipsis: getComputedStyle(name).textOverflow,
        lines: place.getClientRects().length,
        whole: place.scrollWidth <= place.clientWidth,
        inside: kept.left >= outer.left - 0.5 && kept.right <= outer.right + 0.5,
      };
    });
    expect(drawn).toEqual({
      grew: 0,
      cut: true,
      ellipsis: "ellipsis",
      lines: 1,
      whole: true,
      inside: true,
    });
    await expect(epub.status.getByTestId("orca-reflow-place")).toHaveText(/^page \d+ of \d+ · \d+%$/);
  } finally {
    await book.close();
    await obsidian.emulateMobile(false);
  }
});

// What this suite does not cover: a swipe, since the EPUB view has
// none and its arrows and keys turn a screen; the camera and home bar
// of a real phone, which emulation draws at nothing; the EPUB view in a
// tablet's pane under 700px; and the device above the reader settings'
// sheet on a phone on its side, where little room is left for it.
