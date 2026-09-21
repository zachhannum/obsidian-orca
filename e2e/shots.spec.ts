import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator } from "@playwright/test";
import { GROUPS as PANEL_GROUPS, atLevel } from "@/ui/groups";
import { PREVIEW, type Book } from "./harness/book";
import { Export } from "./harness/export";
import { Inspect } from "./harness/inspect";
import { DENSITY as DISPLAY, SAMPLE } from "./harness/launch";
import { NAVIGATOR } from "./harness/navigator";
import { BOOK as BOOK_PAGE, Note } from "./harness/note";
import { Obsidian, type Scheme } from "./harness/obsidian";
import type { Box, Marks, Site } from "./harness/site";
import { expect, test } from "./harness/test";

/** The folder the sample book keeps its notes in. */
const FOLDER = "Twenty Thousand Leagues";

/** The book the site is set from, and the chapter every picture opens on. */
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const CHAPTER = "A Shifting Reef";

/** The face the sample book is set in, which the vault carries. */
const BODY = "EB Garamond";

/** The groups of the design panel, in order. A docs picture crops to each. */
const GROUPS = [
  "Page",
  "Text",
  "Headings",
  "Fonts",
  "Chapter openings",
  "Scene breaks",
  "Heads & folios",
  "Page breaks",
];

/** The heading level the Headings picture shows. */
const LEVEL = 1;

/** The folder the site's pictures are written to. */
const SHOTS = path.resolve(fileURLToPath(import.meta.url), "../../site/src/shots");

/** The folder of notes the quickstart makes a book from, and its notes. */
const DRAFT = "Draft";
const DRAFTED: Record<string, string> = {
  "Chapter One": "# Chapter One\n\nThe house stood at the end of the lane.\n",
  "Chapter Two": "# Chapter Two\n\nBy morning the rain had stopped.\n",
  "Chapter Three": "# Chapter Three\n\nShe opened the letter at the window.\n",
};

/** The book note the quickstart makes, beside the folder. */
const MADE = `${DRAFT}.md`;

/** The item on a folder's menu that makes a book from its notes. */
const CREATE = "Create book from these notes";

/**
 * The window height the book note picture is taken at. It holds the
 * details, the design and the start of the reading order, which is as
 * much of a long book's order as the page needs.
 */
const BOOK_NOTE_HEIGHT = 1100;

/** The ribbon action that shows the navigator. */
const OPEN_ORCA = "Open Orca";

/** The navigator's header action that makes a book with no notes. */
const NEW_BOOK = "New book";

/** The note of the new book that the navigator picture marks. */
const FIRST_DRAFT = "Chapter One";

/** The room around the rows and the menu in the menu picture. */
const PAD = 16;

/** The settings tab that lists the installed plugins, and orca's name there. */
const PLUGINS_TAB = "community-plugins";
const ORCA = "Orca";

/** The preview's own action that turns on inspect mode. */
const INSPECT_PAGE = "Inspect the page";

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

/**
 * The window the inspect picture is taken in, at the landing picture's
 * shape, and the width its design panel is given.
 */
const INSPECT = { width: 1200, height: 750, panel: 440 };

/** The chapter's opening page, and the paragraph the inspect picture pins there. */
const OPENING_PAGE = 9;
const SECOND_PARAGRAPH = "For some time past";

/** The indent the author's rule in the inspect picture sets. */
const OWN_INDENT = "1.5em";

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

/** The actions in a note's header that hand the leaf between the two views. */
const OPEN_PREVIEW = "Open preview";
const AS_MARKDOWN = "Open as markdown";

/** The preview's own action that opens the export dialog. */
const EXPORT = "Export to PDF";

/** The file the export writes beside the book note, named from its title. */
const EXPORTED = `${FOLDER}/Twenty Thousand Leagues Under the Sea.pdf`;

/** The pages the flip-through turns, counted from the spread it opens on. */
const FLIP = 12;

/**
 * The device pixels every picture has for each CSS pixel. The site
 * shows each picture at half its size, so it stays sharp on a dense
 * screen.
 */
const DENSITY = 2;

/**
 * The resolution the pages are rasterized at, in dots per inch. A page
 * at 100 dots per inch is the size the site shows it, so the pages take
 * the same density as the pictures.
 */
const DPI = 100 * DENSITY;

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
  await site.obsidian.size(width, height, DENSITY);
  await site.obsidian.page.waitForFunction(
    (size) =>
      window.innerWidth === size.width &&
      window.innerHeight === size.height &&
      window.devicePixelRatio === size.density,
    { width, height, density: DENSITY },
  );
}

/** The name a group gives its picture, as `heads-and-folios`. */
function slug(group: string): string {
  return group.replace(/ & /g, " and ").toLowerCase().replace(/ /g, "-");
}

/**
 * The controls a group of the design panel draws, and the reset beside
 * each row, by the key each one writes. The Headings group draws one
 * level at a time, so its keys are the first level's. A group that
 * writes no design key, such as Fonts, marks nothing.
 */
function targets(site: Site, group: string): Record<string, Locator> {
  const drawn = PANEL_GROUPS.find((each) => each.name === group);
  if (drawn === undefined) return {};
  const found: Record<string, Locator> = {};
  for (const row of drawn.rows) {
    for (const control of row.of) {
      if (control.kind === "level") found["heading-level"] = site.panel.levels;
      if (control.key === undefined) continue;
      const key = atLevel(control.key, LEVEL);
      found[key] = key === "body-font" ? site.panel.font : site.panel.control(key);
      found[`reset-${key}`] = site.panel.reset(key);
    }
  }
  return found;
}

/** A locator's box, once it has one. */
async function measured(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("nothing to measure");
  return box;
}

/**
 * The smallest crop in whole pixels that holds every box with room
 * around it, kept inside the window.
 */
async function around(site: Site, boxes: Box[], pad: number): Promise<Box> {
  const window = await site.obsidian.page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  const x = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.x)) - pad));
  const y = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.y)) - pad));
  const right = Math.min(
    window.width,
    Math.ceil(Math.max(...boxes.map((box) => box.x + box.width)) + pad),
  );
  const bottom = Math.min(
    window.height,
    Math.ceil(Math.max(...boxes.map((box) => box.y + box.height)) + pad),
  );
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Writes a picture's marks beside it, once both schemes agree on them.
 * The dark picture on disk is twice the size of the crop.
 */
async function sidecar(name: string, taken: Marks[]): Promise<void> {
  const [marks, ...rest] = taken;
  if (marks === undefined) throw new Error(`no marks for ${name}`);
  for (const other of rest) expect(other).toEqual(marks);
  const png = await readFile(path.join(SHOTS, `${name}-dark.png`));
  expect(Math.abs(png.readUInt32BE(16) / DENSITY - marks.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(png.readUInt32BE(20) / DENSITY - marks.height)).toBeLessThanOrEqual(1);
  // Playwright turns the dots in a snapshot name into dashes, and leaves
  // the segments of a path as they are.
  expect(Buffer.from(`${JSON.stringify(marks, null, 2)}\n`)).toMatchSnapshot([
    `${name}.marks.json`,
  ]);
}

test("the pictures are set in a copy of the sample vault", async ({ site }) => {
  // The window is on a copy: the pictures are taken of a vault orca
  // writes to, and the one checked in stays as it is.
  const opened = await site.obsidian.page.evaluate(
    () => (window.app.vault.adapter as unknown as { basePath: string }).basePath,
  );
  expect(opened).not.toEqual(SAMPLE);
  expect(path.basename(opened)).toEqual(path.basename(SAMPLE));
  // The app was launched on a display of the pictures' density, so a
  // run on a plain display does not take them at half the pixels.
  expect(process.env[DISPLAY]).toEqual(String(DENSITY));

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
    expect(painted.accent).toEqual(dark ? "#6366f1" : "#3730a3");
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

      // The last click leaves the pointer over a control, and whether
      // its tooltip is up yet depends on timing.
      await site.obsidian.unhovered();
      await expect(site.obsidian.page).toHaveScreenshot(
        `landing-${scheme}-${String(width)}.png`,
      );
    }
  }

  await site.obsidian.moving();
});

test("the anatomy picture is the whole window, with the navigator, the preview and the panel marked", async ({
  site,
}) => {
  await arrange(site);
  await site.navigator.reveal();
  await settled(site.book);

  const taken: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await settled(site.book);
    await expect(site.navigator.pane).toBeVisible();
    await expect(site.panel.panel).toBeVisible();
    await expect(site.book.sheets).toHaveCount(2);
    await site.obsidian.unhovered();
    taken.push(
      await site.marks(await windowBox(site), {
        "open-orca": site.obsidian.ribbon(OPEN_ORCA),
        navigator: site.obsidian.view(NAVIGATOR),
        preview: site.book.panes,
        panel: site.panel.leaf,
      }),
    );
    await expect(site.obsidian.page).toHaveScreenshot(`anatomy-${scheme}.png`);
  }
  await sidecar("anatomy", taken);

  await site.obsidian.moving();
});

/** The whole window as a box, which a picture of the page is cropped to. */
async function windowBox(site: Site): Promise<Box> {
  return site.obsidian.page.evaluate(() => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }));
}

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
    await site.obsidian.unhovered();
    await expect(site.book.panes).toHaveScreenshot(`phone-${scheme}.png`);
  }

  await site.obsidian.moving();
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
  // The note opens from its file menu straight into Obsidian's editor,
  // never as the book note's own page. That page sets the book again for
  // its folios, and an export after it leaves out the book's CSS.
  await site.obsidian.fileMenu(BOOK, AS_MARKDOWN);
  await expect(site.obsidian.view(EDITOR)).toContainText("orca-book: 1");
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
  const read: Marks[] = [];
  const write: Marks[] = [];
  for (const scheme of SCHEMES) {
    // The hand-off to the editor and back opens a sidebar again, and the
    // picture is of the pane alone, so both go away before each scheme.
    await site.obsidian.put("left");
    await site.obsidian.put("right");
    await expect.poll(async () => site.book.panes.boundingBox()).toMatchObject(pane);
    await site.paint(scheme);
    await settled(site.book);
    read.push(
      await site.marks(site.book.panes, {
        export: site.obsidian.actionIn(PREVIEW, EXPORT),
        inspect: site.obsidian.actionIn(PREVIEW, INSPECT_PAGE),
        "as-markdown": site.obsidian.actionIn(PREVIEW, AS_MARKDOWN),
      }),
    );
    await expect(site.book.panes).toHaveScreenshot(`read-${scheme}.png`);

    // The one leaf, handed to the editor and back by the actions in the
    // headers. The leaf lands on the note behind the page on screen,
    // which is the plate, so the chapter is opened in it.
    await site.obsidian.actionIn(PREVIEW, AS_MARKDOWN).click();
    await expect(editor).toBeVisible();
    await site.obsidian.open(WRITING);
    await expect(editor).toContainText(CHAPTER);
    write.push(
      await site.marks(editor, {
        "open-preview": site.obsidian.actionIn(EDITOR, OPEN_PREVIEW),
      }),
    );
    await expect(editor).toHaveScreenshot(`write-${scheme}.png`);
    await site.obsidian.actionIn(EDITOR, OPEN_PREVIEW).click();
  }
  await sidecar("read", read);
  await sidecar("write", write);

  await site.obsidian.moving();
  await site.obsidian.reopen(layout);
});

test("the export picture is the dialog on the sample book, with the preflight passed", async ({
  site,
}) => {
  await arrange(site);
  const exporting = new Export(site.obsidian);

  const taken: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await settled(site.book);
    await exporting.open();
    await exporting.reaches("ready");
    // The dialog is cropped tight with its corners squared, like the other
    // pictures of a pane, and the page draws the frame.
    const clip = await site.obsidian.unframed(exporting.dialog);
    taken.push(
      await site.marks(clip, {
        destination: exporting.destination,
        choose: exporting.choose,
        write: exporting.write,
        fine: exporting.fine,
      }),
    );
    await expect(site.obsidian.page).toHaveScreenshot(`export-${scheme}.png`, { clip });
    await exporting.close();
  }
  await sidecar("export", taken);

  await site.obsidian.moving();
});

test("a docs picture crops to each group of the design panel", async ({
  site,
}) => {
  await arrange(site);
  expect(await site.panel.grouped()).toEqual(GROUPS);

  const taken = new Map<string, Marks[]>();
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    // The status bar floats over the foot of the panel, so it goes too.
    await site.obsidian.still();
    // The whole panel opens the Design pages, so it is taken from the top
    // before any group is scrolled to.
    await site.panel.leaf.locator(`[data-group="${GROUPS[0]}"]`).scrollIntoViewIfNeeded();
    await expect(site.panel.leaf).toHaveScreenshot(`panel-${scheme}.png`);
    for (const name of GROUPS) {
      const group = site.panel.leaf.locator(`[data-group="${name}"]`);
      const shot = `panel-${slug(name)}`;
      await expect(group).toBeVisible();
      // The picture scrolls a group into view, so the group is scrolled
      // there first and the marks are measured where the picture is taken.
      await group.scrollIntoViewIfNeeded();
      const marks = await site.marks(group, targets(site, name));
      taken.set(shot, [...(taken.get(shot) ?? []), marks]);
      await expect(group).toHaveScreenshot(`${shot}-${scheme}.png`);
    }
  }
  for (const [shot, marks] of taken) await sidecar(shot, marks);

  await site.obsidian.moving();
});

test("the install picture is orca's row in the community plugins settings", async ({
  site,
}) => {
  await arrange(site);
  // Settings open in a window of their own by default, which CDP is not
  // attached to, so they open as a modal for this test.
  const had = await site.obsidian.openSettings(PLUGINS_TAB);
  const toggle = site.obsidian.enabled(ORCA);
  await expect(site.obsidian.installed(ORCA)).toBeVisible();
  await site.obsidian.installed(ORCA).scrollIntoViewIfNeeded();
  // Settings focus their search box on open, and its ring is not part of
  // the step the picture shows.
  await site.obsidian.page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await expect(site.obsidian.page.locator(":focus")).toHaveCount(0);

  const taken: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await expect(toggle).toBeVisible();
    const clip = await site.obsidian.unframed(site.obsidian.settings());
    taken.push(await site.marks(clip, { orca: toggle }));
    await expect(site.obsidian.page).toHaveScreenshot(`install-${scheme}.png`, { clip });
  }
  await sidecar("install", taken);

  await site.obsidian.moving();
  await site.obsidian.closeSettings(had);
});

test("the flip-through's pages come from the book's own PDF", async ({
  site,
}) => {
  await arrange(site);
  await settled(site.book);
  const first = await site.book.reading();

  // The pages are the file an author gets from the preview's own Export
  // button, written beside the book note.
  const exporting = new Export(site.obsidian);
  await site.obsidian.actionIn(PREVIEW, EXPORT).click();
  await exporting.reaches("ready");
  await expect(exporting.destination).toHaveValue(EXPORTED);
  await exporting.write.click();
  await exporting.reaches("written");

  // The dialog once the file is written is a picture too, taken of this
  // one export in both schemes.
  const done: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await expect(exporting.openPdf).toBeVisible();
    const clip = await site.obsidian.unframed(exporting.dialog);
    done.push(await site.marks(clip, { open: exporting.openPdf }));
    await expect(site.obsidian.page).toHaveScreenshot(`export-written-${scheme}.png`, {
      clip,
    });
  }
  await site.obsidian.moving();
  await exporting.close();
  await sidecar("export-written", done);

  // The checked-in sample vault has no PDF, so the export comes back out.
  const exported = path.join(Obsidian.sample(), EXPORTED);
  const pdf = await readFile(exported);
  await rm(exported);
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

// The make pictures come after the landing pictures, so those never
// show the new book, and after the flip-through, so its export is of the
// sample book alone.
test("the make pictures are a folder of notes made into a book", async ({
  site,
}) => {
  await arrange(site);
  const layout = await site.obsidian.layout();
  await site.obsidian.still();
  await site.obsidian.sidebar(TREE_WIDTH, "left");
  await site.obsidian.command(SHOW_TREE);
  const tree = site.obsidian.view(EXPLORER);
  await expect(tree).toContainText(FOLDER);
  await site.obsidian.page.evaluate(
    async ({ folder, notes }) => {
      await window.app.vault.createFolder(folder);
      for (const [name, text] of notes) {
        await window.app.vault.create(`${folder}/${name}.md`, text);
      }
    },
    { folder: DRAFT, notes: Object.entries(DRAFTED) },
  );

  // The menu is the real one Obsidian opens on a right-click, cropped to
  // the folder's row, the rows around it and the menu.
  const row = site.obsidian.treeItem(DRAFT);
  const create = site.obsidian.item(CREATE);
  await expect(row).toBeVisible();
  const menu: Marks[] = [];
  // The menu is opened once and stays open while the scheme changes. A
  // second right-click on the row opens nothing.
  await site.obsidian.contextMenu(row);
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await expect(create).toBeVisible();
    const folder = await measured(row);
    const clip = await around(
      site,
      [{ ...folder, height: folder.height * 4 }, await measured(site.obsidian.menu())],
      PAD,
    );
    const left = Math.floor((await measured(tree)).x);
    const cropped = { ...clip, x: left, width: clip.x + clip.width - left };
    menu.push(await site.marks(cropped, { create }));
    await expect(site.obsidian.page).toHaveScreenshot(`make-menu-${scheme}.png`, {
      clip: cropped,
    });
  }
  await sidecar("make-menu", menu);

  await site.obsidian.choose(CREATE);
  await expect
    .poll(async () =>
      site.obsidian.page.evaluate(
        (at) => window.app.vault.getFileByPath(at) !== null,
        MADE,
      ),
    )
    .toBe(true);
  await expect(site.navigator.book(MADE)).toHaveCount(1);
  const note = new Note(site.obsidian);
  await note.painted();

  // The navigator's header, with the action that makes a book with no
  // notes. The crop ends under the header, so no book is in it.
  await site.navigator.reveal();
  const shelf = site.obsidian.view(NAVIGATOR);
  const newBook = site.navigator.button(NEW_BOOK);
  const header: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await expect(newBook).toBeVisible();
    const pane = await measured(shelf);
    const button = await measured(newBook);
    const clip = {
      x: Math.floor(pane.x),
      y: Math.floor(pane.y),
      width: Math.floor(pane.width),
      height: Math.ceil(button.y + button.height - pane.y + PAD / 2),
    };
    header.push(await site.marks(clip, { "new-book": newBook }));
    await expect(site.obsidian.page).toHaveScreenshot(`make-new-${scheme}.png`, { clip });
  }
  await sidecar("make-new", header);

  // The new book alone, and the book note open as its page.
  const book = site.navigator.book(MADE);
  const made = site.navigator.name(MADE);
  const drafted = site.navigator.entry(MADE, FIRST_DRAFT);
  const page = site.obsidian.view(BOOK_PAGE);
  await book.scrollIntoViewIfNeeded();
  const navigator: Marks[] = [];
  const opened: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await expect(made).toBeVisible();
    await expect(drafted).toBeVisible();
    await expect(note.page).toBeVisible();
    navigator.push(await site.marks(book, { book: made, note: drafted }));
    await expect(book).toHaveScreenshot(`make-navigator-${scheme}.png`);
    opened.push(
      await site.marks(page, {
        "as-markdown": site.obsidian.actionIn(BOOK_PAGE, AS_MARKDOWN),
        "open-preview": site.obsidian.actionIn(BOOK_PAGE, OPEN_PREVIEW),
      }),
    );
    await expect(page).toHaveScreenshot(`make-page-${scheme}.png`);
  }
  await sidecar("make-navigator", navigator);
  await sidecar("make-page", opened);

  // One app takes every picture, so the book and its folder go again.
  await site.obsidian.moving();
  await site.obsidian.reopen(layout);
  await site.obsidian.page.evaluate(
    async (paths) => {
      for (const at of paths) {
        const found = window.app.vault.getAbstractFileByPath(at);
        if (found !== null) await window.app.vault.delete(found, true);
      }
    },
    [MADE, DRAFT],
  );
  await expect(site.navigator.book(MADE)).toHaveCount(0);
  await site.obsidian.asRendered();
});

/** The rule a CSS picture types: it overrides the indent control and holds a declaration fleuron skips. */
const OVERRIDING = "\np + p {\ntext-indent: 0;\nfloat: left;\n}";

/** The control that rule overrides. */
const OVERRIDDEN = "body-first-line-indent";

test("the CSS pictures are the sample book's own CSS, a warning on a rule, and the control that rule overrides", async ({
  site,
}) => {
  await arrange(site);
  const own = await noteText(site);
  await sized(site, INSPECT.width, INSPECT.height);
  await site.obsidian.collapse("left");
  const width = await site.obsidian.sidebar(INSPECT.panel);
  await site.panel.toCss.click();
  // The rules are wider than the panel, so the picture wraps them.
  await site.panel.wrap.click();
  await expect(site.panel.wrap).toHaveAttribute("aria-pressed", "true");
  await settled(site.book);
  await expect(site.panel.flags).toHaveCount(0);

  const css: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await settled(site.book);
    await expect(site.panel.editor).toBeVisible();
    await site.obsidian.unhovered();
    css.push(
      await site.marks(await windowBox(site), {
        controls: site.panel.toControls,
        wrap: site.panel.wrap,
      }),
    );
    await expect(site.obsidian.page).toHaveScreenshot(`css-${scheme}.png`);
  }
  await sidecar("css", css);

  await site.obsidian.moving();
  await typed(site, own, OVERRIDING);
  await expect(site.panel.flags).toHaveCount(1);
  await expect(site.panel.warned).toBeVisible();

  const warning: Marks[] = [];
  const bar: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await settled(site.book);
    // The card is the warning the picture shows, so the pointer rests on
    // the mark rather than off the window.
    await site.obsidian.moving();
    await site.panel.flags.first().hover();
    await expect(site.panel.card).toBeVisible();
    const card = await around(
      site,
      [
        await measured(site.panel.warned),
        await measured(site.panel.editor),
        await measured(site.panel.card),
      ],
      PAD,
    );
    warning.push(
      await site.marks(card, { flag: site.panel.flags.first(), warned: site.panel.warned }),
    );
    await expect(site.obsidian.page).toHaveScreenshot(`css-warning-${scheme}.png`, {
      clip: card,
    });

    await site.obsidian.unhovered();
    await site.book.warnings.click();
    await expect(site.book.issueOpens.first()).toBeVisible();
    const list = site.obsidian.view(PREVIEW).getByTestId("orca-issues");
    const opened = await around(
      site,
      [await measured(site.book.warnings), await measured(list)],
      PAD,
    );
    bar.push(
      await site.marks(opened, {
        warnings: site.book.warnings,
        place: site.book.issueOpens.first(),
      }),
    );
    await expect(site.obsidian.page).toHaveScreenshot(`preview-warnings-${scheme}.png`, {
      clip: opened,
    });
    await site.book.warnings.click();
    await expect(list).toBeHidden();
  }
  await sidecar("css-warning", warning);
  await sidecar("preview-warnings", bar);

  await site.obsidian.moving();
  await site.panel.wrap.click();
  await site.panel.toControls.click();
  await expect(site.panel.overridden(OVERRIDDEN)).toBeVisible();

  const locked: Marks[] = [];
  const header: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await settled(site.book);
    await site.obsidian.unhovered();

    // The switch to the CSS view, cropped from the top of the panel's
    // leaf to just under the switch. The row below scrolls the panel, so
    // the panel goes back to its top first.
    await site.panel.leaf.locator(`[data-group="${GROUPS[0]}"]`).scrollIntoViewIfNeeded();
    const leaf = await measured(site.panel.leaf);
    const button = await measured(site.panel.toCss);
    const top = {
      x: Math.ceil(leaf.x),
      y: Math.ceil(leaf.y),
      width: Math.floor(leaf.width),
      height: Math.ceil(button.y + button.height + PAD - leaf.y),
    };
    header.push(await site.marks(top, { css: site.panel.toCss }));
    await expect(site.obsidian.page).toHaveScreenshot(`css-switch-${scheme}.png`, { clip: top });

    const row = site.panel.row(OVERRIDDEN);
    await row.scrollIntoViewIfNeeded();
    // The field of the row above sits close, so the crop pads by less.
    const clip = await around(site, [await measured(row)], PAD / 2);
    locked.push(await site.marks(clip, { lock: site.panel.overridden(OVERRIDDEN) }));
    await expect(site.obsidian.page).toHaveScreenshot(`css-overridden-${scheme}.png`, { clip });
  }
  await sidecar("css-switch", header);
  await sidecar("css-overridden", locked);

  await site.obsidian.moving();
  await site.panel.toCss.click();
  await untyped(site, own);
  await site.panel.toControls.click();
  await site.obsidian.sidebar(width);
});

/**
 * Types CSS at the end of the author's CSS, and waits for the editor to
 * write it to the note. A note put back before that write is written
 * over by it.
 */
async function typed(site: Site, own: string, css: string): Promise<void> {
  await site.panel.typeCss(css);
  await expect.poll(async () => noteText(site)).not.toEqual(own);
}

/** The book note's text as it is on disk. */
async function noteText(site: Site): Promise<string> {
  return site.obsidian.page.evaluate(async (at) => window.app.vault.adapter.read(at), BOOK);
}

/**
 * Deletes what a picture typed at the end of the author's CSS, in the
 * editor, and waits for the note to hold its own text again. The editor
 * keeps its own copy of the CSS, so a note written from outside it is
 * written over on the next edit.
 */
async function untyped(site: Site, own: string): Promise<void> {
  const extra = (await noteText(site)).length - own.length;
  await site.panel.code.click();
  await site.panel.code.press("ControlOrMeta+End");
  for (let at = 0; at < extra; at++) await site.panel.code.press("Shift+ArrowLeft");
  await site.panel.code.press("Backspace");
  await expect.poll(async () => noteText(site)).toEqual(own);
  await settled(site.book);
}

// The inspect picture is taken last. Its rule is a change to the book
// note, and a change to the note drops the book the flip-through reads.
test("the inspect picture is a pinned paragraph beside the rules that set it", async ({
  site,
}) => {
  await arrange(site);
  const inspect = new Inspect(site.obsidian);
  const own = await noteText(site);
  await sized(site, INSPECT.width, INSPECT.height);
  // The page and the pane are the picture, so the navigator gives its
  // room to them, and the panel is wide enough to read a rule on one line.
  await site.obsidian.collapse("left");
  const width = await site.obsidian.sidebar(INSPECT.panel);
  await settled(site.book);

  await inspect.on();
  await inspect.pinLine(inspect.line(OPENING_PAGE, SECOND_PARAGRAPH));
  let pin = await inspect.pinned();
  await site.panel.inspecting(pin.key, pin.generation);

  // The sample book has no CSS of its own, and an empty layer is not
  // drawn. A rule that wins the indent over the design panel's puts all
  // three layers in the pane, with the one it beat struck through.
  const selector = (await site.panel.selector.textContent()) ?? "";
  const section = selector.replace(/ > p$/, "");
  expect(section).toMatch(/^section#/);
  // The rule is typed over three lines, since one line is wider than the
  // editor and scrolls it sideways under its gutter.
  await typed(site, own, `\n${section} p + p {\ntext-indent: ${OWN_INDENT};\n}`);
  await expect(site.panel.rulesIn("own").first()).toContainText(OWN_INDENT);
  pin = await inspect.pinned();
  await site.panel.inspecting(pin.key, pin.generation);
  await expect(site.panel.ruleGroups).toHaveCount(3);

  const taken: Marks[] = [];
  const adding: Marks[] = [];
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    await settled(site.book);
    await expect(inspect.outline("pinned").getByTestId("orca-inspect-edge")).toBeVisible();
    await expect(site.panel.pane).toBeVisible();
    // The pane scrolls, and its top row holds the pin's own icon.
    await site.panel.unpinButton.scrollIntoViewIfNeeded();
    await site.obsidian.unhovered();
    taken.push(
      await site.marks(await windowBox(site), { inspect: inspect.action }),
    );
    await expect(site.obsidian.page).toHaveScreenshot(`inspect-${scheme}.png`);

    // "Add a rule" sits under the rules, past the foot of the pane, so
    // its picture is the pane scrolled to it above the editor.
    await site.obsidian.moving();
    await site.panel.addRule.scrollIntoViewIfNeeded();
    // The pane is scrolled, so its scrollbar would show in the picture.
    await site.obsidian.still();
    const clip = await around(
      site,
      [await measured(site.panel.pane), await measured(site.panel.editor)],
      PAD,
    );
    adding.push(
      await site.marks(clip, { "add-rule": site.panel.addRule }),
    );
    await expect(site.obsidian.page).toHaveScreenshot(`inspect-add-${scheme}.png`, { clip });
  }
  await sidecar("inspect", taken);
  await sidecar("inspect-add", adding);

  // One app takes every picture, so the note, the mode and the panel's
  // width are put back for the next.
  await site.obsidian.moving();
  await inspect.off();
  await untyped(site, own);
  await site.panel.toControls.click();
  await site.obsidian.sidebar(width);
});

// The book note picture comes after every export. The note's page sets
// the book again, and an export after it leaves out the book's CSS.
test("the book note picture is the sample book's note open as its page", async ({
  site,
}) => {
  await sized(site, WINDOW.width, BOOK_NOTE_HEIGHT);
  const layout = await site.obsidian.layout();
  const note = new Note(site.obsidian);
  await note.open(BOOK);
  await note.painted();
  const page = site.obsidian.view(BOOK_PAGE);
  for (const scheme of SCHEMES) {
    await site.paint(scheme);
    // The status bar floats over the foot of the page, so it goes too.
    await site.obsidian.still();
    await expect(note.page).toBeVisible();
    await expect(page).toHaveScreenshot(`book-note-${scheme}.png`);
  }
  await site.obsidian.moving();
  await site.obsidian.reopen(layout);
  await sized(site, WINDOW.width, WINDOW.height);
});

// What this spec does not cover: the pictures on any platform but the
// one CI takes them on, since a run elsewhere sets the same pages and
// rasterizes them differently; whether the site uses the pictures and
// draws each mark where its sidecar puts it, which the site's build
// answers; heading levels past the first, which the Headings picture
// does not show; installing orca, since the vault already has it; the
// export written to a path outside the vault, which stops at a native
// dialog; and what the design panel holds while a chapter rather than a
// book is being read, which is why the swap pictures are of the pane
// alone.
