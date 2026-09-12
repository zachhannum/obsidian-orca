import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Book } from "./harness/book";
import { SAMPLE } from "./harness/launch";
import type { Scheme } from "./harness/obsidian";
import type { Site } from "./harness/site";
import { expect, test } from "./harness/test";

/** The book the site is set from, and the chapter every picture opens on. */
const BOOK = "Twenty Thousand Leagues Under the Sea.md";
const CHAPTER = "A Shifting Reef";

/** The face the sample book is set in, which the vault carries. */
const BODY = "EB Garamond";

/** The group a docs picture crops to. */
const GROUP = "Text";

/** The two schemes every picture is taken in. */
const SCHEMES: Scheme[] = ["dark", "light"];

/**
 * The widths the landing picture is taken at. The site serves one of
 * the three, so each is the whole window at the same shape.
 */
const WIDTHS = [1440, 1200, 960];

/** The shape of the window, which is what turns a width into a height. */
const SHAPE = 5 / 8;

/**
 * The window the phone picture is taken in. The picture is the preview
 * pane alone, which the phone layout shows at the width of the screen,
 * so the window is only as big as the artboard crops the pane to.
 */
const PHONE = { width: 660, height: 600 };

/** The window every test starts from, which the widths above depart from. */
const WINDOW = { width: 1280, height: 800 };

/** The pages the flip-through turns, counted from the spread it opens on. */
const FLIP = 12;

/** The resolution the pages are rasterized at, in dots per inch. */
const DPI = 100;

/** The stages the preview counts, each of which runs before a page is painted. */
const STAGES = ["style", "lines", "flow", "paint"] as const;

/**
 * The book, open on the spread the site shows: the plate on the verso
 * and the opening of Chapter I on the recto.
 */
async function arrange(site: Site): Promise<void> {
  await sized(site, WINDOW.width, WINDOW.height);
  await site.navigator.reveal();
  // Orca indexes the vault after the window is laid out, and opens
  // nothing while the shelf is still empty. The shelf is what says the
  // book has been found.
  await expect(site.navigator.book(BOOK)).toHaveCount(1);
  await site.book.open();
  // The panel is drawn for the book being read, so it is opened once
  // there is one rather than on the empty state.
  await settled(site.book);
  await site.panel.open();
  await site.book.show("Spread", "spread");
  await site.book.choose(CHAPTER);
  await settled(site.book);
}

/**
 * Waits for the pane to carry the generation it painted and a run of
 * every stage. A picture taken before that is of a pane still working.
 */
async function settled(book: Book): Promise<void> {
  await expect(book.surface).toHaveAttribute("data-generation", /[1-9]\d*/);
  for (const stage of STAGES) {
    await expect(book.surface).toHaveAttribute(
      `data-stage-${stage}`,
      /[1-9]\d*/,
    );
  }
  await expect(book.sheets.first()).toBeVisible();
}

/** Sizes the window and waits for the renderer to be that size. */
async function sized(site: Site, width: number, height: number): Promise<void> {
  await site.obsidian.size(width, height);
  await site.obsidian.page.waitForFunction(
    (size) =>
      window.innerWidth === size.width && window.innerHeight === size.height,
    { width, height },
  );
}

test("the pictures are set in a copy of the sample vault", async ({ site }) => {
  // The window is on a copy: the pictures are taken of a vault orca
  // writes to, and the one checked in stays as it is.
  const opened = await site.obsidian.page.evaluate(
    () => (window.app.vault.adapter as unknown as { basePath: string }).basePath,
  );
  expect(opened).not.toEqual(SAMPLE);
  expect(path.basename(opened)).toEqual(path.basename(SAMPLE));

  await arrange(site);

  // The window is on the site's own book, read through the same page
  // objects as every other spec.
  await expect(site.book.chapterName).toHaveText(CHAPTER);
  expect(await site.panel.reading()).toEqual(BODY);
  await expect(site.navigator.book(BOOK)).toHaveCount(1);
});

test("Obsidian takes the site's colors and fonts, in both schemes", async ({
  site,
}) => {
  await arrange(site);

  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    const painted = await site.obsidian.page.evaluate(() => {
      const style = getComputedStyle(document.body);
      const token = (name: string) => style.getPropertyValue(name).trim();
      return {
        pane: token("--background-primary"),
        side: token("--background-secondary"),
        ribbon: token("--ribbon-background"),
        text: token("--text-normal"),
        accent: token("--interface-accent") || token("--interactive-accent"),
        ui: token("--font-interface"),
        face: document.fonts.check("13px Archivo"),
      };
    });

    // The values are the tokens file's own literals, which the site
    // paints itself from.
    const dark = scheme === "dark";
    expect(painted.pane).toEqual(dark ? "#101317" : "#f6f7f5");
    expect(painted.side).toEqual(dark ? "#101317" : "#f6f7f5");
    expect(painted.ribbon).toEqual(dark ? "#0b0d10" : "#e6e9e5");
    expect(painted.text).toEqual(dark ? "#e9ece8" : "#0a0c0f");
    expect(painted.accent).toEqual(dark ? "#86cfe0" : "#1d6b7d");
    expect(painted.ui).toContain("Archivo");
    expect(painted.face).toEqual(true);
  }
});

test("the landing picture is the whole window, in both schemes, at three widths", async ({
  site,
}) => {
  await arrange(site);

  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    for (const width of WIDTHS) {
      await sized(site, width, Math.round(width * SHAPE));
      await settled(site.book);

      // The navigator on the left, the spread in the middle and the
      // design panel on the right, which is the window the artboard
      // draws.
      await expect(site.navigator.pane).toBeVisible();
      await expect(site.panel.panel).toBeVisible();
      await expect(site.book.sheets).toHaveCount(2);

      await expect(site.obsidian.page).toHaveScreenshot(
        `landing-${scheme}-${String(width)}.png`,
      );
    }
  }
});

test("at phone width the picture is the preview pane alone", async ({
  site,
}) => {
  await arrange(site);
  await sized(site, PHONE.width, PHONE.height);
  await site.obsidian.collapse("left");
  await site.obsidian.collapse("right");

  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await settled(site.book);
    // The navigator and the design panel are off the picture, and the
    // spread the landing page opens on is still on it.
    await expect(site.navigator.pane).toBeHidden();
    await expect(site.book.sheets).toHaveCount(2);
    await expect(site.book.panes).toHaveScreenshot(`phone-${scheme}.png`);
  }
});

test("a docs picture crops to one group of the design panel", async ({
  site,
}) => {
  await arrange(site);
  const group = site.panel.leaf.locator(`[data-group="${GROUP}"]`);

  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await expect(group).toBeVisible();
    await expect(group).toHaveScreenshot(`panel-${GROUP.toLowerCase()}-${scheme}.png`);
  }
});

test("the flip-through's pages come from the book's own PDF", async ({
  site,
}) => {
  await arrange(site);
  await settled(site.book);
  const first = await site.book.reading();

  // The preview and the export come from one session, so the bytes
  // here are the pages the pictures above were taken of.
  const pdf = await site.pdf(BOOK);
  expect(pdf.subarray(0, 5).toString("latin1")).toEqual("%PDF-");

  const where = await mkdtemp(path.join(tmpdir(), "orca-shots-"));
  const written = path.join(where, "sample.pdf");
  await writeFile(written, pdf);
  execFileSync("pdftoppm", [
    "-png",
    "-r",
    String(DPI),
    "-f",
    String(first),
    "-l",
    String(first + FLIP - 1),
    written,
    path.join(where, "page"),
  ]);

  // Poppler pads the number it writes to the width of the last page, so
  // the pages are read back in the order it wrote them rather than by a
  // name built here.
  const rendered = (await readdir(where))
    .filter((file) => file.endsWith(".png"))
    .sort();
  expect(rendered).toHaveLength(FLIP);
  for (const [at, file] of rendered.entries()) {
    const page = await readFile(path.join(where, file));
    const folio = String(first + at).padStart(2, "0");
    expect(page).toMatchSnapshot(["pages", `page-${folio}.png`]);
  }
});

// What this spec does not cover: the pictures on any platform but the
// one CI takes them on, since a run elsewhere sets the same pages and
// rasterizes them differently; the export dialog, which orca has not
// built, so the bytes come off the session the preview is reading; and
// whether the landing page uses the pictures, which the page answers.
