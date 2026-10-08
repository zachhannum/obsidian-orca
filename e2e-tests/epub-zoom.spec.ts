/**
 * The zoom of the preview's EPUB view. It draws the device closer and
 * lays out nothing inside it again, so the assertions are on the size
 * the device is drawn at and on the screens the frame still counts.
 */

import type { Book } from "./harness/book";
import type { Epub } from "./harness/epub";
import { expect, test } from "./harness/test";

/** The zooms the first two steps in stop at, as percentages. */
const STEPS = [125, 150] as const;

/** Opens the book in the EPUB view, at fit. */
async function opened(book: Book, epub: Epub): Promise<void> {
  await book.open();
  await book.painted();
  await epub.open();
  await epub.zoomed(100);
}

/** Puts the device back at fit and the pane back in the single view. */
async function left(book: Book, epub: Epub): Promise<void> {
  await book.zoomPercent.click();
  await epub.zoomed(100);
  await book.show("Single page", "single");
}

/** The middle of the frame, in the window. */
async function middle(epub: Epub): Promise<{ x: number; y: number }> {
  const box = await epub.frame.boundingBox();
  if (box === null) throw new Error("no frame is on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A link in the frame, which the view leaves without its address. */
const LINK = "a[data-href]";

/** A paragraph of prose, which is long enough to run over a line. */
const PROSE = { selector: "p", letters: 120 };

/**
 * The box in the window of the first element under `selector` that is
 * whole on the frame's screen, or nothing. A zoomed device is scrolled
 * first, so the element is in the room.
 */
async function seen(
  epub: Epub,
  selector: string,
  letters = 0,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return epub.frame.evaluate((frame: HTMLIFrameElement, [matching, least]) => {
    const inside = frame.contentDocument;
    const room = frame.closest(".orca-reflow-room");
    if (inside === null || room === null) return null;
    for (const each of inside.querySelectorAll(matching)) {
      const box = each.getBoundingClientRect();
      const whole =
        (each.textContent ?? "").trim().length >= least &&
        box.width > 0 &&
        box.height > 0 &&
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= frame.offsetWidth &&
        box.bottom <= frame.offsetHeight;
      if (!whole) continue;
      const drawn = (): { x: number; y: number; width: number; height: number } => {
        const outer = frame.getBoundingClientRect();
        const scale = outer.width / frame.offsetWidth;
        return {
          x: outer.left + box.left * scale,
          y: outer.top + box.top * scale,
          width: box.width * scale,
          height: box.height * scale,
        };
      };
      const at = drawn();
      const within = room.getBoundingClientRect();
      room.scrollLeft += at.x - within.left - 8;
      room.scrollTop += at.y - within.top - 8;
      return drawn();
    }
    return null;
  }, [selector, letters] as const);
}

/** Turns screen by screen until one holds an element under `selector`. */
async function turnedTo(epub: Epub, selector: string, letters = 0): Promise<void> {
  for (let turns = 0; turns < 40; turns++) {
    if ((await seen(epub, selector, letters)) !== null) return;
    await epub.turn();
  }
  throw new Error(`no screen near the front holds ${selector}`);
}

/** The pixels the host says the device is moved by. */
async function pan(epub: Epub): Promise<number[]> {
  return ((await epub.host.getAttribute("data-pan")) ?? "").split(",").map(Number);
}

test("the control, the keys and the commands zoom the device, and the book inside it is laid out as it was", async ({
  book,
  epub,
  obsidian,
}) => {
  await opened(book, epub);
  await expect(book.zoomPercent).toHaveText("100%");
  await expect(book.zoomOut).toBeDisabled();
  const fitted = await epub.measured();
  const place = await epub.turned();

  await book.zoomIn.click();
  await epub.zoomed(STEPS[0]);
  await expect(book.zoomPercent).toHaveText(`${String(STEPS[0])}%`);
  const closer = await epub.measured();
  expect(closer.drawn.width).toBeCloseTo(fitted.drawn.width * 1.25, 0);
  expect(closer.drawn.height).toBeCloseTo(fitted.drawn.height * 1.25, 0);
  // The frame is the device's screen still, so no line moved.
  expect(closer.frame).toEqual(fitted.frame);
  expect(closer.screen).toEqual(fitted.screen);
  expect(await epub.turned()).toEqual(place);

  await book.key("ControlOrMeta+=");
  await epub.zoomed(STEPS[1]);
  await book.key("ControlOrMeta+-");
  await epub.zoomed(STEPS[0]);
  await book.key("ControlOrMeta+0");
  await epub.zoomed(100);
  expect(await epub.measured()).toEqual(fitted);

  await obsidian.command("orca:zoom-in");
  await epub.zoomed(STEPS[0]);
  await obsidian.command("orca:zoom-out");
  await epub.zoomed(100);
  await obsidian.command("orca:zoom-in");
  await obsidian.command("orca:zoom-fit");
  await epub.zoomed(100);

  await left(book, epub);
});

test("the keys and the wheel with Ctrl held zoom the device from inside the frame, about the pointer", async ({
  book,
  epub,
  obsidian,
}) => {
  await opened(book, epub);
  const { mouse, keyboard } = obsidian.page;
  const at = await middle(epub);
  const pointer = { x: at.x - 40, y: at.y - 60 };

  // A click gives the frame the focus, and its keys stop at its document.
  await mouse.click(pointer.x, pointer.y);
  await keyboard.press("ControlOrMeta+=");
  await epub.zoomed(STEPS[0]);
  await keyboard.press("ControlOrMeta+0");
  await epub.zoomed(100);

  const before = await epub.share(pointer);
  await mouse.move(pointer.x, pointer.y);
  await keyboard.down("Control");
  try {
    await mouse.wheel(0, -300);
    await expect.poll(async () => epub.zoom()).toBeGreaterThan(150);
  } finally {
    await keyboard.up("Control");
  }
  const after = await epub.share(pointer);
  expect(after.x).toBeCloseTo(before.x, 2);
  expect(after.y).toBeCloseTo(before.y, 2);

  await left(book, epub);
});

test("a drag with Space held moves a zoomed device, and selects no text in it", async ({
  book,
  epub,
  obsidian,
}) => {
  await opened(book, epub);
  await book.zoomIn.click();
  await book.zoomIn.click();
  await epub.zoomed(STEPS[1]);
  const from = await middle(epub);
  const [, top = 0] = await pan(epub);

  const { mouse, keyboard } = obsidian.page;
  await mouse.click(from.x, from.y);
  await keyboard.down("Space");
  try {
    await expect(epub.host).toHaveClass(/is-hand/);
    await mouse.down();
    await mouse.move(from.x, from.y - 60, { steps: 6 });
    await mouse.up();
    // The device follows the pointer, so a drag up scrolls it down.
    await expect(epub.host).toHaveAttribute("data-pan", new RegExp(`,${String(top + 60)}$`));
  } finally {
    await keyboard.up("Space");
  }
  await expect(epub.host).not.toHaveClass(/is-hand/);
  expect(await epub.selected()).toBe("");

  await book.zoomPercent.click();
  await epub.zoomed(100);
  // Space at fit takes no hand.
  await mouse.move(from.x, from.y);
  await keyboard.down("Space");
  await keyboard.up("Space");
  await expect(epub.host).not.toHaveClass(/is-hand/);

  await left(book, epub);
});

test("a double click on a zoomed device selects the word it selects at fit, and a click on a link follows none", async ({
  book,
  epub,
  obsidian,
}) => {
  await opened(book, epub);
  const { mouse } = obsidian.page;
  await turnedTo(epub, PROSE.selector, PROSE.letters);
  const select = async (): Promise<string> => {
    const box = await seen(epub, PROSE.selector, PROSE.letters);
    if (box === null) throw new Error("no paragraph is on screen");
    // The point is a share of the paragraph's box, so it is over the
    // same word at any zoom.
    await mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5, { clickCount: 2 });
    return epub.selected();
  };
  const fitted = await select();
  expect(fitted.length).toBeGreaterThan(0);

  await book.zoomIn.click();
  await book.zoomIn.click();
  await epub.zoomed(STEPS[1]);
  expect(await select()).toBe(fitted);

  // The frame runs no script and its links carry no address, so a
  // click on one leaves the reader where they were, as it does at fit.
  await book.zoomPercent.click();
  await epub.zoomed(100);
  await turnedTo(epub, LINK);
  const place = await epub.turned();
  const leaves = await obsidian.page.evaluate(() => document.querySelectorAll(".workspace-leaf").length);
  const click = async (): Promise<void> => {
    const box = await seen(epub, LINK);
    if (box === null) throw new Error("no link is on screen");
    await mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await epub.turned()).toEqual(place);
    expect(
      await obsidian.page.evaluate(() => document.querySelectorAll(".workspace-leaf").length),
    ).toBe(leaves);
  };
  await click();
  await book.zoomIn.click();
  await book.zoomIn.click();
  await epub.zoomed(STEPS[1]);
  await click();
  await epub.zoomed(STEPS[1]);

  await left(book, epub);
});

test("a page and a device are zoomed apart: the view that is left goes back to fit, and a turn keeps the zoom", async ({
  book,
  epub,
}) => {
  await book.open();
  await book.painted();
  await book.zoomIn.click();
  await book.zoomed(STEPS[0]);

  await epub.open();
  await epub.zoomed(100);
  await book.zoomed(100);
  await expect(book.zoomPercent).toHaveText("100%");

  await book.zoomIn.click();
  await epub.zoomed(STEPS[0]);
  const at = await epub.turned();
  await epub.next.click();
  await expect.poll(async () => epub.turned()).not.toEqual(at);
  await epub.zoomed(STEPS[0]);

  await book.show("Single page", "single");
  await book.zoomed(100);
  await epub.zoomed(100);
});

// What this suite does not cover: how sharp the type is, which is the
// browser's to rasterize. The suite checks that the device is drawn at
// the zoomed size and that the frame inside it keeps its own. A pinch
// on a real trackpad, which Chromium sends as the wheel this suite
// sends. A drag that selects words in the frame: Playwright asks each
// frame under a drag whether one began, and a frame sandboxed without
// scripts never answers, so the suite selects by a double click. A
// link that is followed, since the EPUB view follows none at
// any zoom. A pinch on a touch screen is in `mobile-epub.spec.ts`.
