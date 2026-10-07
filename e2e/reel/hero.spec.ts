import type { Locator } from "@playwright/test";
import { PREVIEW } from "../harness/book";
import { Export } from "../harness/export";
import { rowsIn } from "../harness/frames";
import { expect, test } from "../harness/test";

/** The folder the sample book keeps its notes in, the book note, and the chapter the take writes. */
const FOLDER = "Twenty Thousand Leagues";
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const CHAPTER = "A Shifting Reef";
const WRITING = `${FOLDER}/${CHAPTER}.md`;
const EXPORTED = ["pdf", "epub"].map(
  (format) => `${FOLDER}/Twenty Thousand Leagues Under the Sea.${format}`,
);

/**
 * The folio the chapter's spread opens on, in the sample book and in
 * the book the take starts from. A session that set the chapter out of
 * its place opens it hundreds of pages on.
 */
const OPENS = 8;
const OPENS_BARE = 8;

/** The width the design panel is given, and the navigator's. */
const PANEL = 400;
const NAVIGATOR = 300;

/** The views and actions the take clicks, by the names Obsidian gives them. */
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
 * The book the take starts from: smaller type set tighter and flush
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

/** The face the drop cap is set in, and what the take types to find it. */
const CAP_FONT = "IM FELL English";
const CAP_FILTER = "Fell";

/**
 * The rule the CSS scene types at the end of the book's CSS. It is
 * typed without its closing brace, which the editor writes.
 */
const RULE = `\n\n${COLOURED.split("\n").slice(1, 6).join("\n")}\ncolor: ${TEAL};`;

/** The lines the rule fills once the editor has closed its brace. */
const RULE_LINES = 7;

/** The book note as the take starts it. */
function bare(book: string): string {
  let text = book;
  for (const [from, to] of BARE) {
    if (!text.includes(from)) throw new Error(`the book note has no ${JSON.stringify(from)}`);
    text = text.replace(from, to);
  }
  return text;
}

test("the hero's frames are real Obsidian on the sample book", async ({ reel }) => {
  const { site, vault } = reel;
  const { obsidian } = site;
  await reel.begin({ book: BOOK, chapter: CHAPTER, folio: OPENS });
  const chapter = await vault.read(WRITING);
  await vault.modify(BOOK, bare(await vault.read(BOOK)));
  // The editor writes the chapter and the export writes the book.
  for (const written of [WRITING, ...EXPORTED]) vault.touch(written);

  await site.navigator.reveal();
  await obsidian.sidebar(NAVIGATOR, "left");
  await expect(site.navigator.book(BOOK)).toHaveCount(1);

  // Chapters stay notes: the navigator beside the book note's own page.
  await obsidian.put("right");
  await obsidian.open(BOOK);
  await expect(obsidian.view("orca-book").getByTestId("orca-book")).toBeVisible();
  await reel.frame("notes", {
    shelf: site.navigator.book(BOOK),
    chapter: site.navigator.entry(BOOK, CHAPTER),
    note: obsidian.view("orca-book"),
  });

  // Write, then format: the chapter empty, then written, then set.
  await obsidian.open(WRITING);
  const editor = obsidian.view(EDITOR);
  await expect(editor).toBeVisible();
  await reel.editorHolds("");
  await expect(editor.locator(".cm-line").first()).toHaveText("");
  await reel.frame("write-empty");
  await reel.editorHolds(chapter);
  await expect(editor).toContainText("The year 1866");
  await expect.poll(async () => vault.read(WRITING)).toEqual(chapter);
  await reel.frame(
    "write",
    { preview: obsidian.actionIn(EDITOR, OPEN_PREVIEW) },
    { rows: await rowsIn(editor.locator(".cm-content")) },
  );
  // A session that saw the chapter empty sets it after the colophon
  // once it is written again. Orca is loaded again here, so the preview
  // sets the book from the notes as they are on disk.
  await obsidian.reloadPlugin();
  await obsidian.actionIn(EDITOR, OPEN_PREVIEW).click();
  await expect(site.book.surface).toBeVisible();
  await reel.opensOn(CHAPTER, OPENS_BARE);
  // Orca opens the design panel as it loads, and the take has not
  // reached it yet.
  await obsidian.put("right");
  await reel.frame("read", { manuscript: site.book.asMarkdown });

  // Design in the panel: each click sets the book again.
  await obsidian.collapse("left");
  await site.panel.open();
  await obsidian.sidebar(PANEL);
  await expect(site.panel.panel).toBeVisible();
  await reel.settled();
  const scroll = site.panel.scroller;
  const controls = {
    "size-up": site.panel.up("body-size"),
    "spacing-up": site.panel.up("body-line-spacing"),
    justify: site.panel.choice("body-align", "justify"),
    css: site.panel.toCss,
    scroller: site.panel.scroller,
  };
  await reel.frame("design-0", controls, { scroll });
  let taking = 0;
  /** Does one thing in the panel, waits for the pages it sets, and takes the frame after it. */
  const step = async (act: () => Promise<void>, marks: Record<string, Locator>): Promise<void> => {
    const before = await site.book.painted();
    await act();
    await expect.poll(async () => site.book.painted()).toBeGreaterThan(before);
    await reel.settled();
    taking += 1;
    await reel.frame(`design-${String(taking)}`, marks, { scroll });
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
  await reel.scrolledTo(site.panel.scroller, "scroll-down", bottom / 2);
  await site.panel.scrollTo(site.panel.control("chapter-drop-cap-font"));
  taking += 1;
  await reel.frame(`design-${String(taking)}`, cap, { scroll });
  await step(async () => {
    await site.panel.control("chapter-drop-cap").selectOption({ label: "3 lines" });
  }, cap);
  // The picker, open on the faces the filter leaves.
  await site.panel.control("chapter-drop-cap-font").click();
  await expect(site.panel.filter).toBeVisible();
  await site.panel.type(CAP_FILTER);
  await expect(site.panel.option(CAP_FONT)).toBeVisible();
  taking += 1;
  await reel.frame(
    `design-${String(taking)}`,
    { ...cap, option: site.panel.option(CAP_FONT) },
    { focused: true, scroll },
  );
  await step(async () => {
    await site.panel.option(CAP_FONT).click();
    await expect(site.panel.control("chapter-drop-cap-font")).toContainText(CAP_FONT);
  }, cap);
  // Back up to the switch to the book's CSS.
  await reel.scrolledTo(site.panel.scroller, "scroll-up", bottom / 2);
  await site.panel.scroller.evaluate((scroller) => {
    scroller.scrollTop = 0;
  });
  taking += 1;
  await reel.frame(
    `design-${String(taking)}`,
    { css: site.panel.toCss, scroller: site.panel.scroller },
    { scroll },
  );

  // Go further in CSS: the book's own CSS, and a rule typed at its end.
  await site.panel.toCss.click();
  await expect(site.panel.editor).toBeVisible();
  // The rules are wider than the panel, so the editor wraps them.
  await site.panel.wrap.click();
  await expect(site.panel.wrap).toHaveAttribute("aria-pressed", "true");
  await reel.frame(
    "css-0",
    { code: site.panel.editor, controls: site.panel.toControls },
    { scroll },
  );
  await site.panel.code.click();
  await site.panel.code.press("ControlOrMeta+End");
  await site.panel.code.press("Enter");
  await reel.frame("css-1", { code: site.panel.editor }, { scroll, paint: site.panel.editor });
  const typedFrom = await site.book.painted();
  await site.panel.code.pressSequentially(RULE.slice(1));
  await expect.poll(async () => vault.read(BOOK)).toMatch(/p\.part \{\s*color: #1d4e5b;/);
  await expect.poll(async () => site.book.painted()).toBeGreaterThan(typedFrom);
  await reel.settled();
  // The editor closed the brace on the line under the caret, so it is
  // scrolled to its end to show it.
  await site.panel.editor.evaluate((drawn) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const scroller = drawn.querySelector(".cm-scroller");
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
  });
  await expect(site.panel.editor.locator(".cm-line").last()).toBeInViewport();
  await reel.frame(
    "css-2",
    { code: site.panel.editor, export: obsidian.actionIn(PREVIEW, EXPORT) },
    { rows: await rowsIn(site.panel.editor, RULE_LINES), scroll },
  );

  // Export the book, from the preview's own action.
  const exporting = new Export(obsidian);
  await obsidian.actionIn(PREVIEW, EXPORT).click();
  await exporting.reaches("ready");
  await reel.frame("export-0", { write: exporting.write, dialog: exporting.dialog }, { scroll });
  await exporting.write.click();
  await exporting.reaches("written");
  await reel.frame("export-1", { dialog: exporting.dialog }, { scroll });
  await exporting.close();

  // One app runs every take of a shard, so the panel goes back as well.
  await site.panel.wrap.click();
  await site.panel.toControls.click();
  await reel.end();
});

// What this spec does not cover: whether the player shows each frame
// where its marks put it, which a look at the landing page answers; the
// frames on any platform but the one they were taken on; the pointer,
// which the player draws itself because a picture of the window holds
// none; and a book whose chapter moves off its folio, which stops the
// take rather than being set right.
