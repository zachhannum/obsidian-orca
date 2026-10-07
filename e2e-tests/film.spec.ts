import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { PREVIEW, type Book } from "./harness/book";
import { Export } from "./harness/export";
import { Obsidian, type Scheme } from "./harness/obsidian";
import type { Box, Site } from "./harness/site";
import { expect, test } from "./harness/test";

/** The folder the sample book keeps its notes in, the book note, and the chapter the film writes. */
const FOLDER = "Twenty Thousand Leagues";
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const CHAPTER = "A Shifting Reef";
const WRITING = `${FOLDER}/${CHAPTER}.md`;
const EXPORTED = `${FOLDER}/Twenty Thousand Leagues Under the Sea.pdf`;

/**
 * The film's assets folder, in its own repo, which the film reads its
 * frames and its pages from. The spec writes nowhere else.
 */
const OUT = process.env["ORCA_FILM_OUT"];
const PAGES = path.join(OUT ?? "", "pages");

/**
 * The folder each scheme's frames go in. The film plays the dark ones,
 * and the loop on the site's landing page plays both.
 */
const FOLDERS: Record<Scheme, string> = { dark: "ui", light: "ui-light" };

/**
 * The window every frame is taken in. The film shows it at about its
 * CSS size, and the density leaves room for the camera to push in.
 */
const WINDOW = { width: 1200, height: 750 };
const DENSITY = 3;

/** The width the design panel is given, and the navigator's. */
const PANEL = 400;
const NAVIGATOR = 300;

/** The stages the preview counts, each of which runs before a page is painted. */
const STAGES = ["style", "lines", "flow", "paint"] as const;

/** The views and actions the film clicks, by the names Obsidian gives them. */
const EDITOR = "markdown";
const OPEN_PREVIEW = "Open preview";
const EXPORT = "Export book";

/** The book's colour beside black, and the rule of the book's CSS that sets it. */
const TEAL = "#1d4e5b";
const COLOURED = `/* The book prints in one colour beside black. */
section.chapter h2,
section.chapter p:first-of-type::first-letter,
section.part h1,
section.title-page h1,
section.contents p.part {
  color: ${TEAL};
}

`;

/**
 * The book the film starts from: smaller type set tighter and flush
 * left, no drop cap, and all in black. The panel and the CSS scene
 * then build the sample book back up.
 */
const BARE: [string, string][] = [
  ["body-size: 10.5pt", "body-size: 9pt"],
  ["body-line-spacing: 14pt", "body-line-spacing: 12.5pt"],
  ["body-align: justify", "body-align: left"],
  ["chapter-drop-cap: 3\n", ""],
  ["chapter-drop-cap-font: IM FELL English\n", ""],
  [COLOURED, ""],
];

/** The steps up the panel takes for the type size and for the line spacing. */
const SIZE_STEPS = 3;

/** The face the drop cap is set in, and what the film types to find it. */
const CAP_FONT = "IM FELL English";
const CAP_FILTER = "Fell";

/**
 * The rule the CSS scene types at the end of the book's CSS. It is
 * typed without its closing brace, which the editor writes.
 */
const RULE = `\n\n${COLOURED.split("\n").slice(1, 6).join("\n")}\ncolor: ${TEAL};`;

/** The lines the rule fills once the editor has closed its brace. */
const RULE_LINES = 7;

/** The pages of the exported book the film's closing wall is made of, and their resolution. */
const WALL = 24;
const WALL_DPI = 60;

/** One frame: a picture of the window, and the boxes the film points at in it. */
interface Frame {
  name: string;
  marks: Record<string, Box>;
  rows?: Box[];
  /** The distance the design panel is scrolled, which the film animates between frames. */
  scroll?: number;
}

/** The folder the frames of the run under way go in, and the frames it has taken. */
let into = "";
let taken: Frame[] = [];

/** The frames each scheme took, which must point at the same boxes. */
const tookIn = new Map<Scheme, Frame[]>();

/**
 * Takes a picture of the whole window and keeps the boxes of the
 * targets. The pointer is off the window, so no control is drawn as
 * hovered: the film draws its own pointer.
 */
async function frame(
  site: Site,
  name: string,
  targets: Record<string, Locator> = {},
  rows?: Box[],
  // A frame of an open menu keeps the focus, since the menu closes without it.
  focused = false,
): Promise<void> {
  await site.obsidian.unhovered();
  // A sidebar whose leaf is active draws its tab in the accent, so the
  // pane in the middle is made the active one, without the focus.
  if (!focused) {
    await site.obsidian.page.evaluate(() => {
      const { workspace } = window.app;
      const middle = workspace.getMostRecentLeaf(workspace.rootSplit);
      if (middle !== null) workspace.setActiveLeaf(middle, { focus: false });
      (document.activeElement as HTMLElement | null)?.blur();
    });
  }
  // Obsidian flashes the tab of a sidebar it has just revealed.
  await expect(site.obsidian.page.locator(".workspace-tab-header.is-flashing")).toHaveCount(0);
  const marks = await site.marks(
    { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height },
    targets,
  );
  await site.obsidian.page.screenshot({
    path: path.join(into, `${name}.jpg`),
    type: "jpeg",
    quality: 88,
    scale: "device",
  });
  const scroll = (await site.panel.scroller.isVisible()) ? await site.panel.scrolled() : undefined;
  taken.push({
    name,
    marks: marks.marks,
    ...(rows === undefined ? {} : { rows }),
    ...(scroll === undefined ? {} : { scroll }),
  });
}

/**
 * Waits for the pane to carry a painted generation and a run of every
 * stage, and for the book to be quiet at that generation.
 */
async function settled(book: Book): Promise<void> {
  await expect(book.surface).toHaveAttribute("data-generation", /[1-9]\d*/);
  for (const stage of STAGES) {
    await expect(book.surface).toHaveAttribute(`data-stage-${stage}`, /[1-9]\d*/);
  }
  await book.settled(BOOK);
}

/**
 * Scrolls the design panel, and takes a frame there when named. The
 * film draws a scroll from the frames either side and one between.
 */
async function scrolledTo(site: Site, name: string | null, top: number): Promise<void> {
  await site.panel.scroller.evaluate((scroller, to) => {
    scroller.scrollTop = to;
  }, Math.round(top));
  if (name !== null) await frame(site, name, { scroller: site.panel.scroller });
}

/** Sizes the window and waits for the renderer to be that size. */
async function sized(site: Site): Promise<void> {
  await site.obsidian.size(WINDOW.width, WINDOW.height, DENSITY);
  await site.obsidian.page.waitForFunction(
    (size) =>
      window.innerWidth === size.width &&
      window.innerHeight === size.height &&
      window.devicePixelRatio === size.density,
    { ...WINDOW, density: DENSITY },
  );
}

/**
 * The rows of text an editor draws, one box per visual row, in reading
 * order. The film uncovers them one after another as the typing.
 */
async function rowsIn(editor: Locator, last = 0): Promise<Box[]> {
  return editor.evaluate((root, count) => {
    const rects: DOMRect[] = [];
    for (const line of [...root.querySelectorAll(".cm-line")].slice(-count)) {
      const range = document.createRange();
      range.selectNodeContents(line);
      rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
    }
    // A wrapped line and the marks inside it each give a box, so the
    // boxes that share a row are joined into one.
    rects.sort((a, b) => a.top - b.top || a.left - b.left);
    const rows: { x: number; y: number; width: number; height: number }[] = [];
    for (const rect of rects) {
      const last = rows[rows.length - 1];
      const middle = rect.top + rect.height / 2;
      if (last !== undefined && middle > last.y && middle < last.y + last.height) {
        const right = Math.max(last.x + last.width, rect.right);
        last.x = Math.min(last.x, rect.left);
        last.width = right - last.x;
      } else {
        rows.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      }
    }
    return rows
      .filter((row) => row.y + row.height > 0 && row.y < innerHeight)
      .map((row) => ({
        x: Math.round(row.x),
        y: Math.round(row.y),
        width: Math.round(row.width),
        height: Math.round(row.height),
      }));
  }, last);
}

/** The note's text as it is on disk. */
async function noteText(site: Site, at: string): Promise<string> {
  return site.obsidian.page.evaluate(async (file) => window.app.vault.adapter.read(file), at);
}

/** Writes a note back to the text it had, and waits for the disk to hold it. */
async function putBack(site: Site, at: string, text: string): Promise<void> {
  await site.obsidian.page.evaluate(
    async (wrote) => {
      const note = window.app.vault.getFileByPath(wrote.at);
      if (note === null) throw new Error(`no note at ${wrote.at}`);
      await window.app.vault.modify(note, wrote.text);
    },
    { at, text },
  );
  await expect.poll(async () => noteText(site, at)).toEqual(text);
}

/** The book note as the film starts it. */
function bare(book: string): string {
  let text = book;
  for (const [from, to] of BARE) {
    if (!text.includes(from)) throw new Error(`the book note has no ${JSON.stringify(from)}`);
    text = text.replace(from, to);
  }
  return text;
}

/** Puts this text in the editor in front, and takes the focus off it so no caret or markup shows. */
async function editorHolds(site: Site, text: string): Promise<void> {
  await site.obsidian.page.evaluate((value) => {
    const editor = window.app.workspace.activeEditor?.editor;
    if (editor === undefined) throw new Error("no editor in front");
    editor.setValue(value);
    (document.activeElement as HTMLElement | null)?.blur();
  }, text);
}

/**
 * The colors the loop draws over a frame with: the CSS editor's ground,
 * which hides the rows not yet typed, and the text, which is the caret.
 */
async function paintOf(site: Site): Promise<{ cover: string; caret: string }> {
  return site.panel.editor.evaluate((editor) => {
    let ground = "";
    for (let at: Element | null = editor; at !== null && ground === ""; at = at.parentElement) {
      const color = getComputedStyle(at).backgroundColor;
      if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") ground = color;
    }
    const text = editor.querySelector(".cm-content") ?? editor;
    return { cover: ground, caret: getComputedStyle(text).color };
  });
}

/** Takes every frame in one scheme, and puts the notes and the panel back. */
async function take(site: Site, scheme: Scheme): Promise<void> {
  if (OUT === undefined) throw new Error("ORCA_FILM_OUT names no folder to write the frames to");
  into = path.join(OUT, FOLDERS[scheme]);
  taken = [];
  await rm(into, { recursive: true, force: true });
  await mkdir(into, { recursive: true });
  const book = await noteText(site, BOOK);
  const chapter = await noteText(site, WRITING);
  const obsidian = site.obsidian;
  await putBack(site, BOOK, bare(book));

  await sized(site);
  await site.paint(scheme);
  await obsidian.asRendered();
  await site.navigator.reveal();
  await obsidian.sidebar(NAVIGATOR, "left");
  await expect(site.navigator.book(BOOK)).toHaveCount(1);

  // Chapters stay notes: the navigator beside the book note's own page.
  await obsidian.put("right");
  await obsidian.open(BOOK);
  await expect(obsidian.view("orca-book").getByTestId("orca-book")).toBeVisible();
  await frame(site, "notes", {
    shelf: site.navigator.book(BOOK),
    chapter: site.navigator.entry(BOOK, CHAPTER),
    note: obsidian.view("orca-book"),
  });

  // Write, then format: the chapter empty, then written, then set.
  await obsidian.open(WRITING);
  const editor = obsidian.view(EDITOR);
  await expect(editor).toBeVisible();
  await editorHolds(site, "");
  await expect(editor.locator(".cm-line").first()).toHaveText("");
  await frame(site, "write-empty");
  await editorHolds(site, chapter);
  await expect(editor).toContainText("The year 1866");
  await expect.poll(async () => noteText(site, WRITING)).toEqual(chapter);
  await frame(
    site,
    "write",
    { preview: obsidian.actionIn(EDITOR, OPEN_PREVIEW) },
    await rowsIn(editor.locator(".cm-content")),
  );
  await obsidian.actionIn(EDITOR, OPEN_PREVIEW).click();
  await expect(site.book.surface).toBeVisible();
  await site.book.show("Spread", "spread");
  await site.book.choose(CHAPTER);
  await settled(site.book);
  await frame(site, "read");

  // Design in the panel: each click sets the book again.
  await obsidian.collapse("left");
  await site.panel.open();
  await obsidian.sidebar(PANEL);
  await expect(site.panel.panel).toBeVisible();
  await settled(site.book);
  const controls = {
    "size-up": site.panel.up("body-size"),
    "spacing-up": site.panel.up("body-line-spacing"),
    justify: site.panel.choice("body-align", "justify"),
    css: site.panel.toCss,
    scroller: site.panel.scroller,
  };
  await frame(site, "design-0", controls);
  let taking = 0;
  /** Does one thing in the panel, waits for the pages it sets, and takes the frame after it. */
  const step = async (act: () => Promise<void>, marks: Record<string, Locator>): Promise<void> => {
    const before = await site.book.painted();
    await act();
    await expect.poll(async () => site.book.painted()).toBeGreaterThan(before);
    await settled(site.book);
    taking += 1;
    await frame(site, `design-${taking}`, marks);
  };
  for (const key of ["body-size", "body-line-spacing"]) {
    for (let at = 0; at < SIZE_STEPS; at += 1) {
      await step(async () => site.panel.up(key).click(), controls);
    }
  }
  await step(async () => site.panel.choice("body-align", "justify").click(), controls);

  // The drop cap rows are further down the panel.
  const cap = {
    "drop-cap": site.panel.control("chapter-drop-cap"),
    "cap-font": site.panel.control("chapter-drop-cap-font"),
    scroller: site.panel.scroller,
  };
  const bottom = await site.panel.scrollTo(site.panel.control("chapter-drop-cap-font"));
  await scrolledTo(site, "scroll-down", bottom / 2);
  await site.panel.scrollTo(site.panel.control("chapter-drop-cap-font"));
  taking += 1;
  await frame(site, `design-${taking}`, cap);
  await step(async () => {
    await site.panel.control("chapter-drop-cap").selectOption({ label: "3 lines" });
  }, cap);
  // The picker, open on the faces the filter leaves.
  await site.panel.control("chapter-drop-cap-font").click();
  await expect(site.panel.filter).toBeVisible();
  await site.panel.type(CAP_FILTER);
  await expect(site.panel.option(CAP_FONT)).toBeVisible();
  taking += 1;
  await frame(site, `design-${taking}`, { ...cap, option: site.panel.option(CAP_FONT) }, undefined, true);
  await step(async () => {
    await site.panel.option(CAP_FONT).click();
    await expect(site.panel.control("chapter-drop-cap-font")).toContainText(CAP_FONT);
  }, cap);
  // Back up to the switch to the book's CSS.
  await scrolledTo(site, "scroll-up", bottom / 2);
  await scrolledTo(site, null, 0);
  taking += 1;
  await frame(site, `design-${taking}`, { css: site.panel.toCss, scroller: site.panel.scroller });

  // Go further in CSS: the book's own CSS, and a rule typed at its end.
  await site.panel.toCss.click();
  await expect(site.panel.editor).toBeVisible();
  // The rules are wider than the panel, so the editor wraps them.
  await site.panel.wrap.click();
  await expect(site.panel.wrap).toHaveAttribute("aria-pressed", "true");
  await frame(site, "css-0", { code: site.panel.editor, controls: site.panel.toControls });
  await site.panel.code.click();
  await site.panel.code.press("ControlOrMeta+End");
  await site.panel.code.press("Enter");
  await frame(site, "css-1", { code: site.panel.editor });
  const paint = await paintOf(site);
  const typedFrom = await site.book.painted();
  await site.panel.code.pressSequentially(RULE.slice(1));
  await expect.poll(async () => noteText(site, BOOK)).toMatch(/p\.part \{\s*color: #1d4e5b;/);
  await expect.poll(async () => site.book.painted()).toBeGreaterThan(typedFrom);
  await settled(site.book);
  // The editor closed the brace on the line under the caret, so it is
  // scrolled to its end to show it.
  await site.panel.editor.evaluate((editor) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const scroller = editor.querySelector(".cm-scroller");
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
  });
  await expect(site.panel.editor.locator(".cm-line").last()).toBeInViewport();
  await frame(
    site,
    "css-2",
    { code: site.panel.editor, export: obsidian.actionIn(PREVIEW, EXPORT) },
    await rowsIn(site.panel.editor, RULE_LINES),
  );

  // Export the book, from the preview's own action.
  const exporting = new Export(obsidian);
  await obsidian.actionIn(PREVIEW, EXPORT).click();
  await exporting.reaches("ready");
  await frame(site, "export-0", { write: exporting.write, dialog: exporting.dialog });
  await exporting.write.click();
  await exporting.reaches("written");
  await frame(site, "export-1", { dialog: exporting.dialog });
  await exporting.close();

  // A script rather than JSON, since the film is opened from disk and a
  // page there cannot fetch.
  const listed = JSON.stringify({ window: WINDOW, density: DENSITY, scheme, paint, frames: taken });
  await writeFile(path.join(into, "frames.js"), `window.FRAMES = ${listed};\n`);
  // The loop draws its pointer from one set of boxes, so a scheme that
  // moved a control would send it to the wrong place.
  for (const [other, frames] of tookIn) {
    if (other !== scheme) expect(taken).toEqual(frames);
  }
  tookIn.set(scheme, taken);

  // The wall of pages is the same in both schemes, so one takes it.
  if (scheme === "dark") await wall();

  // One app runs the whole run, so the notes and the panel go back.
  await obsidian.moving();
  await putBack(site, BOOK, book);
  await putBack(site, WRITING, chapter);
  await site.panel.wrap.click();
  await site.panel.toControls.click();
  await settled(site.book);
  // The other scheme opens its own panes.
  await site.book.close();
  await obsidian.detach(EDITOR);
  await obsidian.detach("orca-book");
}

for (const scheme of ["dark", "light"] as const) {
  test(`the film's frames are real Obsidian on the sample book, ${scheme}`, async ({ site }) =>
    take(site, scheme));
}

/** Writes the first pages of the exported book, which the film closes on, and takes the file away. */
async function wall(): Promise<void> {

  const exported = path.join(Obsidian.sample(), EXPORTED);
  const pdf = await readFile(exported);
  await rm(exported);
  expect(pdf.subarray(0, 5).toString("latin1")).toEqual("%PDF-");
  const where = await mkdtemp(path.join(tmpdir(), "orca-film-"));
  const written = path.join(where, "book.pdf");
  await writeFile(written, pdf);
  execFileSync("pdftoppm", ["-jpeg", "-jpegopt", "quality=88", "-r", String(WALL_DPI), "-f", "1", "-l", String(WALL), written, path.join(where, "page")]);
  await rm(PAGES, { recursive: true, force: true });
  await mkdir(PAGES, { recursive: true });
  const rendered = (await readdir(where)).filter((file) => file.endsWith(".jpg")).sort();
  expect(rendered).toHaveLength(WALL);
  for (const [at, file] of rendered.entries()) {
    await writeFile(
      path.join(PAGES, `page-${String(at + 1).padStart(2, "0")}.jpg`),
      await readFile(path.join(where, file)),
    );
  }
  await rm(where, { recursive: true, force: true });
}

// What this spec does not cover: whether the film shows each frame
// where its marks put it, which a look at the film answers; the frames
// on any platform but the one they were taken on; the marks of one
// scheme when the other did not run first; and the pointer, which the
// film draws itself because a picture of the window holds none.
