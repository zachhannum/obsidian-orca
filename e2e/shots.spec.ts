import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PREVIEW, type Book } from "./harness/book";
import { SAMPLE } from "./harness/launch";
import type { Scheme } from "./harness/obsidian";
import type { Site } from "./harness/site";
import { expect, test } from "./harness/test";

/** The folder the sample book keeps its notes in. */
const FOLDER = "Twenty Thousand Leagues";

/** The book the site is set from, and the chapter every picture opens on. */
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
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

/**
 * The narrowest of them, where the navigator and the design panel
 * together leave the spread too little room to read. The navigator
 * comes off the picture there, the way an author narrowing a window
 * puts it away.
 */
const NARROW = Math.min(...WIDTHS);

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

/**
 * The window the swap pictures are taken in. Both are of the one leaf,
 * which is the same box in both, so the page can fade one into the
 * other.
 */
const SWAP = { width: 980, height: 620 };

/** The ribbon down the side of the window, which is beside the pane. */
const RIBBON = 44;

/** The window's own bars above and below the pane. */
const BARS = 40;

/** Obsidian's own file tree, which the vault picture is of. */
const EXPLORER = "file-explorer";

/**
 * The commands that show the tree and open it on the note being read.
 * The tree is Obsidian's own view, so it is asked for the way the app
 * asks for it: a leaf made by hand carries none of its contents.
 */
const SHOW_TREE = "file-explorer:open";

/** The room the tree is given, which is the width the artboard draws it at. */
const TREE_WIDTH = 300;

/** The heading the book note's reading order opens with. */
const ORDER = "# Front matter";

/** The chapter the swap pictures are written from. */
const WRITING = `${FOLDER}/${CHAPTER}.md`;
const REVEAL = "file-explorer:reveal-active-file";

/** The editor's own view type, which a chapter is written in. */
const EDITOR = "markdown";

/** The view orca draws a book note in, which the way back is an action on. */
const NOTE = "orca-book";

/** The actions in a note's header that hand the leaf between the two views. */
const AS_BOOK = "Open as book";
const AS_MARKDOWN = "Open as markdown";

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
      const shelf = width > NARROW;
      if (shelf) await site.navigator.reveal();
      else await site.obsidian.collapse("left");
      await settled(site.book);

      // The navigator on the left, the spread in the middle and the
      // design panel on the right, which is the window the artboard
      // draws. The narrowest window gives the navigator's room to the
      // spread.
      await expect(site.navigator.pane).toBeVisible({ visible: shelf });
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

test("the vault picture is the file tree and the book note's own Markdown", async ({
  site,
}) => {
  await arrange(site);
  // One app runs the whole suite, so the leaves this test opens and the
  // settings it changes are put back before the next picture is taken.
  const layout = await site.obsidian.layout();
  await site.obsidian.still();
  await site.obsidian.asSource();
  // The tree draws nothing while its sidebar has no room, and an
  // earlier picture may have put that sidebar away. The sidebar is
  // opened and given its room first, then the tree is asked for.
  await site.obsidian.sidebar(TREE_WIDTH, "left");
  await site.obsidian.command(SHOW_TREE);
  await expect(site.obsidian.view(EXPLORER)).toContainText(FOLDER);
  // The book note is opened as Markdown so the picture is of the text
  // on disk. Opening it also tells the tree which folder to unfold.
  await site.obsidian.open(BOOK);
  // Both the book note and the preview offer the way to the Markdown,
  // so the click is on the book note's own header.
  await site.obsidian.actionIn(NOTE, AS_MARKDOWN).click();
  await site.obsidian.command(REVEAL);

  // The note opens on its properties, and the reading order is what the
  // picture is of, so the note is scrolled to where the two meet.
  await site.obsidian.scrollTo(ORDER);

  const tree = site.obsidian.view(EXPLORER);
  const note = site.obsidian.view(EDITOR);
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    // The folder holds the book note beside the chapters it lists, and
    // the note itself is the Markdown, not a form drawn over it.
    await expect(tree).toContainText(FOLDER);
    await expect(note).toContainText("orca-book: 1");

    await expect(tree).toHaveScreenshot(`vault-tree-${scheme}.png`);
    await expect(note).toHaveScreenshot(`vault-note-${scheme}.png`);
  }

  await site.obsidian.moving();
  await site.obsidian.asRendered();
  await site.obsidian.reopen(layout);
});

test("the swap pictures are one window, written and then set", async ({
  site,
}) => {
  await arrange(site);
  const layout = await site.obsidian.layout();
  // The note is read the way a vault is read by default, whatever an
  // earlier picture left behind.
  await site.obsidian.asRendered();
  await site.obsidian.still();
  await sized(site, SWAP.width, SWAP.height);
  // Both sidebars come off: the picture is the pane alone, which is
  // what swaps. The design panel empties while a chapter is being
  // written, so it has no place in a picture of the two states.
  await site.obsidian.put("left");
  await site.obsidian.put("right");
  // The pane is the picture, so its size is the picture's size. A pane
  // still holding room for a sidebar makes a picture of another shape.
  const pane = { width: SWAP.width - RIBBON, height: SWAP.height - BARS };
  await expect.poll(async () => site.book.panes.boundingBox()).toMatchObject(pane);

  const editor = site.obsidian.view(EDITOR);
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await settled(site.book);
    await expect(site.book.panes).toHaveScreenshot(`read-${scheme}.png`);

    // The one leaf, handed to the editor and back by the actions in the
    // headers. The leaf lands on the note behind the page on screen,
    // which is the plate, so the chapter is opened in it.
    await site.obsidian.actionIn(PREVIEW, AS_MARKDOWN).click();
    await expect(editor).toBeVisible();
    await site.obsidian.open(WRITING);
    await expect(editor).toContainText(CHAPTER);
    await expect(editor).toHaveScreenshot(`write-${scheme}.png`);
    await site.obsidian.actionIn(EDITOR, AS_BOOK).click();
  }

  await site.obsidian.moving();
  await site.obsidian.reopen(layout);
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
// built, so the bytes come off the session the preview is reading;
// whether the landing page uses the pictures, which the page answers;
// and what the design panel holds while a chapter rather than a book is
// being read, which is why the swap pictures are of the pane alone.
