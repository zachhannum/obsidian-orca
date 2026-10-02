/**
 * The preview's EPUB view: the engine's EPUB in a sandboxed frame the
 * size of a device's screen, paged by ReadiumCSS. No page is laid out
 * for it, so the assertions are on the frame and on what it holds.
 */

import {
  DEVICES,
  DEVICE_DEFAULT,
  READER_DEFAULTS,
  READER_SIZE_MAX,
  READER_SIZE_STEP,
  READER_VARIABLES,
  deviceBox,
  readerInset,
} from "@/style/reader";
import type { Book } from "./harness/book";
import type { Epub } from "./harness/epub";
import { PLUGIN } from "./harness/launch";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault, and the first chapter it lists. */
const BOOK = "Pride and Prejudice.md";
const CHAPTER = "Chapter Twelve.md";

/** The heading of that chapter's document, and the words it opens on. */
const CHAPTER_NAME = "Chapter Twelve";
const OPENS = "In consequence of an agreement";

/** The words an edit puts in their place. */
const EDITED = "In defiance of every agreement";

/** The one variable the defaults set. */
const DEFAULTS = { "--RS__pageGutter": "32px" };

/** The sepia theme's background, as a browser computes it. */
const SEPIA = "rgb(250, 244, 232)";

/** Turns screen by screen until the frame holds the document headed `name`. */
async function turnTo(epub: Epub, name: string): Promise<void> {
  const { sections } = await epub.turned();
  for (;;) {
    if ((await epub.heading()) === name) return;
    const at = await epub.turned();
    expect(at.section, `no section is headed ${name}`).toBeLessThan(sections);
    await epub.turn();
  }
}

/** The variables the view has set, without the properties ReadiumCSS does not read. */
async function set(epub: Epub): Promise<Record<string, string>> {
  const all = await epub.variables();
  return Object.fromEntries(
    Object.entries(all).filter(([name]) => READER_VARIABLES.includes(name)),
  );
}

test("the EPUB view loads the engine's files into a sandboxed frame, finds the first chapter there, and pages through it", async ({
  book,
  epub,
}) => {
  await book.open();
  const generation = await book.settled(BOOK);

  expect(await epub.open()).toBe(generation);
  expect(await epub.sandbox()).toBe("allow-same-origin");
  // The engine's documents link a sheet of their own, so ReadiumCSS
  // goes before it and after it and the default sheet stays out.
  expect(await epub.sheets()).toEqual(["before", "own", "after"]);
  expect(await epub.turned()).toMatchObject({ section: 1, screen: 1 });
  await expect(epub.previous).toBeDisabled();

  await turnTo(epub, CHAPTER_NAME);
  expect(await epub.words()).toContain(OPENS);

  const opened = await epub.turned();
  expect(opened.screen).toBe(1);
  expect(opened.screens).toBeGreaterThan(1);
  expect((await epub.measured()).scrolled).toBe(0);

  // A screen is a scroll of one frame width.
  const turned = await epub.turn();
  expect(turned).toEqual({ ...opened, screen: 2 });
  const { frame, scrolled } = await epub.measured();
  expect(scrolled).toBe(frame.width);
  await expect(epub.status).toHaveText(
    `section ${String(turned.section)} of ${String(turned.sections)} · screen 2 of ${String(turned.screens)}`,
  );

  // The arrow keys turn as the buttons do.
  await book.key("ArrowLeft");
  await expect(epub.view).toHaveAttribute("data-screen", "1");

  // A turn back off a section's first screen opens the one before at
  // its last.
  await epub.previous.click();
  await expect(epub.view).toHaveAttribute("data-section", String(opened.section - 1));
  const before = await epub.turned();
  expect(before.screen).toBe(before.screens);
});

test("each device sets the screen to its size, with the frame inset in it and the body scaled to the pane", async ({
  book,
  epub,
}) => {
  await book.open();
  await book.settled(BOOK);
  await epub.open();
  await expect(epub.view).toHaveAttribute("data-device", DEVICE_DEFAULT);

  for (const device of DEVICES) {
    await epub.device.selectOption(device.id);
    await expect(epub.view).toHaveAttribute("data-device", device.id);
    const { screen, frame, drawn } = await epub.measured();
    expect(screen).toEqual({ width: device.width, height: device.height });
    // The frame is the screen less the room above and below the text.
    const inset = readerInset(READER_DEFAULTS, device);
    expect(frame).toEqual({
      width: device.width,
      height: device.height - inset.top - inset.bottom,
      top: inset.top,
    });
    // The body is never drawn larger than it is, and it keeps its shape.
    const body = deviceBox(device);
    expect(drawn.width).toBeLessThanOrEqual(body.width + 1);
    expect(drawn.width / drawn.height).toBeCloseTo(body.width / body.height, 2);
    const well = await epub.view.boundingBox();
    expect(drawn.width).toBeLessThanOrEqual((well?.width ?? 0) + 1);
    expect(drawn.height).toBeLessThanOrEqual((well?.height ?? 0) + 1);
  }
});

test("each reader setting changes the ReadiumCSS variable it maps to", async ({ book, epub }) => {
  await book.open();
  await book.settled(BOOK);
  await epub.open();
  await turnTo(epub, CHAPTER_NAME);

  expect(await set(epub)).toEqual(DEFAULTS);

  await epub.settings.click();

  await epub.setting("font").selectOption("oldStyle");
  await expect
    .poll(() => set(epub))
    .toEqual({ ...DEFAULTS, "--USER__fontFamily": "var(--RS__oldStyleTf)" });
  await epub.setting("font").selectOption("publisher");
  await expect.poll(() => set(epub)).toEqual(DEFAULTS);

  const { screens } = await epub.turned();
  await epub.setting("size-up").click();
  await epub.setting("size-up").click();
  await expect(epub.setting("size")).toHaveValue("150%");
  await expect.poll(() => set(epub)).toEqual({ ...DEFAULTS, "--USER__fontSize": "150%" });
  // Larger type is more screens of it, and the view counts them again.
  await expect
    .poll(async () => (await epub.turned()).screens)
    .toBeGreaterThan(screens);
  await epub.setting("size-down").click();
  await epub.setting("size-down").click();
  await expect.poll(() => set(epub)).toEqual(DEFAULTS);

  await epub.setting("spacing").selectOption("1.5");
  await expect.poll(() => set(epub)).toEqual({ ...DEFAULTS, "--USER__lineHeight": "1.5" });
  await epub.setting("spacing").selectOption("publisher");
  await expect.poll(() => set(epub)).toEqual(DEFAULTS);

  await epub.setting("margins-wide").click();
  await expect.poll(() => set(epub)).toEqual({ "--RS__pageGutter": "56px" });
  await epub.setting("margins-normal").click();
  await expect.poll(() => set(epub)).toEqual(DEFAULTS);

  // The top and bottom margins are the frame's inset in the screen. No
  // variable moves, and a shorter frame is more screens. The type is at
  // its largest here, so the chapter is screens enough to show it.
  const normal = await epub.measured();
  for (let size = READER_DEFAULTS.size; size < READER_SIZE_MAX; size += READER_SIZE_STEP) {
    await epub.setting("size-up").click();
  }
  const largest = { ...DEFAULTS, "--USER__fontSize": `${String(READER_SIZE_MAX)}%` };
  await expect.poll(() => set(epub)).toEqual(largest);
  await epub.setting("vertical-narrow").click();
  await expect
    .poll(async () => (await epub.measured()).frame)
    .toEqual({
      width: normal.frame.width,
      height: normal.screen.height - 2 * 16,
      top: 16,
    });
  const narrow = await epub.turned();
  await epub.setting("vertical-wide").click();
  await expect
    .poll(async () => (await epub.measured()).frame)
    .toEqual({
      width: normal.frame.width,
      height: normal.screen.height - 2 * 56,
      top: 56,
    });
  await expect
    .poll(async () => (await epub.turned()).screens)
    .toBeGreaterThan(narrow.screens);
  expect(await set(epub)).toEqual(largest);
  await epub.setting("vertical-normal").click();
  for (let size = READER_SIZE_MAX; size > READER_DEFAULTS.size; size -= READER_SIZE_STEP) {
    await epub.setting("size-down").click();
  }
  await expect.poll(() => set(epub)).toEqual(DEFAULTS);
  await expect.poll(async () => (await epub.measured()).frame).toEqual(normal.frame);

  await epub.setting("align-justify").click();
  await expect.poll(() => set(epub)).toEqual({ ...DEFAULTS, "--USER__textAlign": "justify" });
  await epub.setting("align-publisher").click();
  await expect.poll(() => set(epub)).toEqual(DEFAULTS);

  await epub.setting("theme-sepia").click();
  await expect.poll(() => set(epub)).toEqual({
    ...DEFAULTS,
    "--USER__backgroundColor": "#faf4e8",
    "--USER__textColor": "#121212",
    "--USER__linkColor": "#305282",
    "--USER__visitedColor": "#7b5281",
  });
  // ReadiumCSS reads the variable, so the screen takes the colour.
  expect(await epub.computed("background-color")).toBe(SEPIA);
  await epub.setting("theme-light").click();
  await expect.poll(() => set(epub)).toEqual(DEFAULTS);
});

test("an edit repaints the EPUB view where the reader is", async ({ book, epub, vault }) => {
  await book.open();
  await book.settled(BOOK);
  const generation = await epub.open();
  await turnTo(epub, CHAPTER_NAME);
  const at = await epub.turned();

  const text = await vault.read(CHAPTER);
  expect(text).toContain(OPENS);
  await vault.modify(CHAPTER, text.replace(OPENS, EDITED));

  await expect.poll(() => epub.painted()).toBeGreaterThan(generation);
  await expect.poll(() => epub.words()).toContain(EDITED);
  expect(await epub.words()).not.toContain(OPENS);
  expect(await epub.heading()).toBe(CHAPTER_NAME);
  expect(await epub.turned()).toMatchObject({ section: at.section, screen: at.screen });

  await vault.restore();
  await expect.poll(() => epub.words()).toContain(OPENS);
});

/** A device and a value of each setting that is not the one a pane opens with. */
const CHOSEN = {
  device: "ipad",
  settings: {
    font: "sans",
    size: 125,
    spacing: 1.5,
    margins: "wide",
    vertical: "narrow",
    align: "justify",
    theme: "sepia",
  },
};

/** The variables those settings put on the frame's root. */
const CHOSEN_SET = {
  "--USER__fontFamily": "var(--RS__sansTf)",
  "--USER__fontSize": "125%",
  "--USER__lineHeight": "1.5",
  "--RS__pageGutter": "56px",
  "--USER__textAlign": "justify",
  "--USER__backgroundColor": "#faf4e8",
  "--USER__textColor": "#121212",
  "--USER__linkColor": "#305282",
  "--USER__visitedColor": "#7b5281",
};

/** Holds that the pane is in the EPUB view on the chosen device with the chosen settings. */
async function cameBack(book: Book, epub: Epub): Promise<void> {
  await epub.painted();
  await expect(epub.view).toHaveAttribute("data-device", CHOSEN.device);
  // The page controls give way, as they do after the switch itself.
  await expect(book.folio).toBeHidden();
  await expect(book.view("EPUB")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => set(epub)).toEqual(CHOSEN_SET);
  // The top and bottom margins move no variable, so the frame says them.
  expect((await epub.measured()).frame.top).toBe(16);
  await epub.settings.click();
  await expect(epub.setting("font")).toHaveValue(CHOSEN.settings.font);
  await expect(epub.setting("size")).toHaveValue("125%");
  await expect(epub.setting("spacing")).toHaveValue("1.5");
  for (const key of ["margins-wide", "vertical-narrow", "align-justify", "theme-sepia"]) {
    await expect(epub.setting(key)).toHaveAttribute("aria-pressed", "true");
  }
  await epub.settings.click();
}

test("the EPUB view, the device and every reader setting come back in a new pane, a workspace reopened and a window reloaded", async ({
  book,
  epub,
  obsidian,
  vault,
}) => {
  await book.open();
  await book.settled(BOOK);
  await epub.open();
  await epub.device.selectOption(CHOSEN.device);
  await epub.settings.click();
  await epub.setting("font").selectOption("sans");
  await epub.setting("size-up").click();
  await epub.setting("spacing").selectOption("1.5");
  await epub.setting("margins-wide").click();
  await epub.setting("vertical-narrow").click();
  await epub.setting("align-justify").click();
  await epub.setting("theme-sepia").click();
  await epub.settings.click();
  await expect.poll(() => set(epub)).toEqual(CHOSEN_SET);

  // The plugin's data keeps the view beside the page view, and the
  // device and the settings with it.
  const kept = async (): Promise<unknown> => JSON.parse((await vault.data(PLUGIN)) ?? "{}");
  await expect.poll(kept).toMatchObject({ view: "single", epub: true, reader: CHOSEN });

  // The pane's own state keeps the view, so a workspace reopened comes
  // back in it.
  const layout = await obsidian.layout();
  await book.close();
  await expect(book.panes).toHaveCount(0);
  await obsidian.reopen(layout);
  await expect(book.panes).toHaveCount(1);
  await cameBack(book, epub);

  // A new pane opens as the last one was left.
  await book.close();
  await expect(book.panes).toHaveCount(0);
  await book.open();
  await cameBack(book, epub);

  // A window reloaded reads all of it back from the plugin's data.
  await book.close();
  await expect(book.panes).toHaveCount(0);
  await obsidian.reload();
  await book.open();
  await cameBack(book, epub);

  // A page view chosen is kept the same way, and the EPUB view goes.
  await book.view("Single page").click();
  await expect(epub.view).toHaveCount(0);
  await expect(book.folio).toBeVisible();
  await expect.poll(kept).toMatchObject({ view: "single", epub: false, reader: CHOSEN });
});

test("nothing the EPUB view does writes to the vault, and the book note is untouched", async ({
  book,
  epub,
  obsidian,
  vault,
}) => {
  await book.open();
  await book.settled(BOOK);
  const note = await vault.bytes(BOOK);
  const chapter = await vault.bytes(CHAPTER);

  const changes = await vault.changes(async () => {
    await epub.open();
    for (const device of DEVICES) {
      await epub.device.selectOption(device.id);
      await expect(epub.view).toHaveAttribute("data-device", device.id);
    }
    await epub.settings.click();
    await epub.setting("font").selectOption("sans");
    await epub.setting("size-up").click();
    await epub.setting("spacing").selectOption("2");
    await epub.setting("margins-narrow").click();
    await epub.setting("vertical-wide").click();
    await epub.setting("align-start").click();
    await epub.setting("theme-dark").click();
    await expect.poll(() => set(epub)).toMatchObject({
      "--USER__fontFamily": "var(--RS__sansTf)",
      "--USER__fontSize": "125%",
      "--USER__lineHeight": "2",
      "--RS__pageGutter": "16px",
      "--USER__textAlign": "start",
      "--USER__backgroundColor": "#000000",
    });
    await epub.settings.click();
    // The workspace keeps the page view the pane was in beside the
    // EPUB view, so the pane has one to go back to.
    const layout = JSON.stringify(await obsidian.layout());
    expect(layout).toContain('"view":"single"');
    expect(layout).toContain('"epub":true');
    await turnTo(epub, CHAPTER_NAME);
    await epub.turn();
    // Back to the pages, which is the view the pane keeps.
    await book.view("Single page").click();
    await expect(epub.view).toHaveCount(0);
  });

  expect(changes).toEqual([]);
  expect((await vault.bytes(BOOK)).equals(note)).toBe(true);
  expect((await vault.bytes(CHAPTER)).equals(chapter)).toBe(true);
});

// What this suite does not cover: the view on a phone or a tablet, where
// the bar wraps, and a book whose documents link no sheet, which the
// engine does not write. A link inside the frame is not followed, and
// nothing here clicks one. Two panes open at once are not held to each
// other: a change in one is kept, and the other shows it when it is
// next opened. A data file from before the EPUB view was kept is read
// in the Node tier.
