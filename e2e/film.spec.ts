import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator } from "@playwright/test";
import { PREVIEW, type Book } from "./harness/book";
import { Export } from "./harness/export";
import { Obsidian } from "./harness/obsidian";
import type { Box, Site } from "./harness/site";
import { expect, test } from "./harness/test";

/** The folder the sample book keeps its notes in, the book note, and the chapter the film writes. */
const FOLDER = "Twenty Thousand Leagues";
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const CHAPTER = "A Shifting Reef";
const WRITING = `${FOLDER}/${CHAPTER}.md`;
const EXPORTED = `${FOLDER}/Twenty Thousand Leagues Under the Sea.pdf`;

/** The folder the film reads its frames and its pages from. */
const OUT = path.resolve(fileURLToPath(import.meta.url), "../../video/assets");
const FRAMES = path.join(OUT, "ui");
const PAGES = path.join(OUT, "pages");

/**
 * The window every frame is taken in. The film shows it at about its
 * CSS size, and the density leaves room for the camera to push in.
 */
const WINDOW = { width: 1200, height: 750 };
const DENSITY = 2;

/** The width the design panel is given, and the navigator's. */
const PANEL = 400;
const NAVIGATOR = 300;

/** The stages the preview counts, each of which runs before a page is painted. */
const STAGES = ["style", "lines", "flow", "paint"] as const;

/** The views and actions the film clicks, by the names Obsidian gives them. */
const EDITOR = "markdown";
const OPEN_PREVIEW = "Open preview";
const EXPORT = "Export to PDF";

/**
 * The rule the CSS scene types at the end of the book's CSS. It is
 * typed without its closing brace, which the editor writes.
 */
const RULE =
  "\n\nsection.chapter h1,\nsection.chapter h2,\nsection.chapter p:first-of-type::first-letter {\ncolor: #9e2a2b;";

/** The pages of the exported book the film's closing wall is made of, and their resolution. */
const WALL = 24;
const WALL_DPI = 60;

/** One frame: a picture of the window, and the boxes the film points at in it. */
interface Frame {
  name: string;
  marks: Record<string, Box>;
  rows?: Box[];
}

const taken: Frame[] = [];

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
): Promise<void> {
  await site.obsidian.unhovered();
  // A sidebar whose leaf is active draws its tab in the accent, so the
  // pane in the middle is made the active one, without the focus.
  await site.obsidian.page.evaluate(() => {
    const { workspace } = window.app;
    const middle = workspace.getMostRecentLeaf(workspace.rootSplit);
    if (middle !== null) workspace.setActiveLeaf(middle, { focus: false });
    (document.activeElement as HTMLElement | null)?.blur();
  });
  // Obsidian flashes the tab of a sidebar it has just revealed.
  await expect(site.obsidian.page.locator(".workspace-tab-header.is-flashing")).toHaveCount(0);
  const marks = await site.marks(
    { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height },
    targets,
  );
  await site.obsidian.page.screenshot({
    path: path.join(FRAMES, `${name}.jpg`),
    type: "jpeg",
    quality: 88,
    scale: "device",
  });
  taken.push({ name, marks: marks.marks, ...(rows === undefined ? {} : { rows }) });
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
async function rowsIn(editor: Locator): Promise<Box[]> {
  return editor.evaluate((root) => {
    const rects: DOMRect[] = [];
    for (const line of root.querySelectorAll(".cm-line")) {
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
  });
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

/** Puts this text in the editor in front, and takes the focus off it so no caret or markup shows. */
async function editorHolds(site: Site, text: string): Promise<void> {
  await site.obsidian.page.evaluate((value) => {
    const editor = window.app.workspace.activeEditor?.editor;
    if (editor === undefined) throw new Error("no editor in front");
    editor.setValue(value);
    (document.activeElement as HTMLElement | null)?.blur();
  }, text);
}

test("the film's frames are real Obsidian on the sample book", async ({ site }) => {
  await rm(FRAMES, { recursive: true, force: true });
  await mkdir(FRAMES, { recursive: true });
  const book = await noteText(site, BOOK);
  const chapter = await noteText(site, WRITING);
  const obsidian = site.obsidian;

  await sized(site);
  await obsidian.paint("dark");
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
    "outside-up": site.panel.up("margin-outside"),
    left: site.panel.choice("body-align", "left"),
    justify: site.panel.choice("body-align", "justify"),
    css: site.panel.toCss,
  };
  await frame(site, "design-0", controls);
  const steps: [string, Locator][] = [
    ["design-1", site.panel.up("body-size")],
    ["design-2", site.panel.up("body-size")],
    ["design-3", site.panel.up("body-line-spacing")],
    ["design-4", site.panel.up("body-line-spacing")],
    ["design-5", site.panel.up("margin-outside")],
    ["design-6", site.panel.up("margin-outside")],
  ];
  for (const [name, button] of steps) {
    const before = await site.book.painted();
    await button.click();
    await expect.poll(async () => site.book.painted()).toBeGreaterThan(before);
    await settled(site.book);
    await frame(site, name, controls);
  }
  for (const [name, align] of [["design-7", "left"], ["design-8", "justify"]] as const) {
    const was = await site.book.painted();
    await site.panel.choice("body-align", align).click();
    await expect.poll(async () => site.book.painted()).toBeGreaterThan(was);
    await settled(site.book);
    await frame(site, name, controls);
  }

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
  const typedFrom = await site.book.painted();
  await site.panel.code.pressSequentially(RULE.slice(1));
  await expect.poll(async () => noteText(site, BOOK)).toContain("#9e2a2b");
  await expect.poll(async () => site.book.painted()).toBeGreaterThan(typedFrom);
  await settled(site.book);
  await (await site.panel.code.elementHandle())?.evaluate((code) => (code as HTMLElement).blur());
  await frame(
    site,
    "css-2",
    { code: site.panel.editor, export: obsidian.actionIn(PREVIEW, EXPORT) },
    await rowsIn(site.panel.editor),
  );

  // Export to PDF, from the preview's own action.
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
  const listed = JSON.stringify({ window: WINDOW, density: DENSITY, frames: taken });
  await writeFile(path.join(FRAMES, "frames.js"), `window.FRAMES = ${listed};\n`);

  // The wall of pages the film closes on is the file the export wrote.
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

  // One app runs the whole run, so the notes and the panel go back.
  await obsidian.moving();
  await putBack(site, BOOK, book);
  await putBack(site, WRITING, chapter);
  await site.panel.wrap.click();
  await site.panel.toControls.click();
  await settled(site.book);
});

// What this spec does not cover: whether the film shows each frame
// where its marks put it, which a look at the film answers; the frames
// on any platform but the one they were taken on; the light scheme,
// which the film does not use; and the pointer, which the film draws
// itself because a picture of the window holds none.
