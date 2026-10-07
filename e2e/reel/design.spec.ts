import type { Locator } from "@playwright/test";
import { BOOK as NOTE } from "../harness/note";
import { expect, test } from "../harness/test";

/** The folder the sample book keeps its notes in, the book note, and the chapter the take shows. */
const FOLDER = "Twenty Thousand Leagues";
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const CHAPTER = "A Shifting Reef";

/**
 * The folio the chapter's spread opens on, in the sample book and in
 * the book the take starts from. A session that set the chapter out of
 * its place opens it hundreds of pages on.
 */
const OPENS = 8;
const OPENS_FRESH = 8;

/** The width the design panel is given. */
const PANEL = 400;

/** The keys a new book note holds. Every other key is a design key. */
const KEPT = ["orca-book", "title", "author", "language"];

/** The trim the take picks, by the value the note writes for it. */
const TRIM = "5.5in 8.5in";

/** The sizes the take types, for the text and for the line over a chapter's title. */
const BODY_SIZE = "10pt";
const LINE_SIZE = "9pt";

/** The face the chapter's title is set in, and what the take types to find it. */
const TITLE_FONT = "IM FELL English";
const TITLE_FILTER = "Fell";

/**
 * The book note as a new book has it: the keys orca writes for a new
 * book and the reading order, with no design key and no CSS.
 */
function fresh(book: string): string {
  const [, matter, order] = /^---\n([\s\S]*?)\n---\n([\s\S]*?)```css\n/.exec(book) ?? [];
  if (matter === undefined || order === undefined) {
    throw new Error("the book note has no front matter over a CSS block");
  }
  const kept = matter.split("\n").filter((line) => KEPT.some((key) => line.startsWith(`${key}:`)));
  if (kept.length !== KEPT.length) throw new Error("the book note lacks a key a new book has");
  return `---\n${kept.join("\n")}\n---\n${order.trimEnd()}\n`;
}

test("the design reel builds a page from a book note with no design", async ({ reel }) => {
  const { site, vault } = reel;
  const { obsidian, panel, book } = site;
  await reel.begin({ book: BOOK, chapter: CHAPTER, folio: OPENS });
  await vault.modify(BOOK, fresh(await vault.read(BOOK)));
  await expect.poll(async () => vault.read(BOOK)).not.toContain("trim:");
  // A session that saw the book with its design can set a chapter out
  // of its place. Orca is loaded again here, so the preview sets the
  // book from the note as it is on disk.
  await obsidian.reloadPlugin();
  await obsidian.open(BOOK);
  await book.open();
  await expect(book.surface).toBeVisible();
  await reel.opensOn(CHAPTER, OPENS_FRESH);
  // The preview is the one tab in the middle, as it is in the hero.
  await obsidian.detach(NOTE);

  await obsidian.put("left");
  await panel.open();
  await obsidian.sidebar(PANEL);
  await expect(panel.panel).toBeVisible();
  await reel.settled();
  const scroller = panel.scroller;
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });

  let taking = 0;
  /** Takes the next frame, with the controls the pointer goes to from it. */
  const take = async (marks: Record<string, Locator>, focused = false): Promise<void> => {
    await reel.frame(`d${String(taking)}`, { ...marks, scroller }, { focused, scroll: scroller });
    taking += 1;
  };
  /** Does one thing in the panel, waits for the pages it sets, and takes the frame after it. */
  const step = async (act: () => Promise<void>, marks: Record<string, Locator>): Promise<void> => {
    const before = await book.painted();
    await act();
    await expect.poll(async () => book.painted()).toBeGreaterThan(before);
    await reel.settled();
    await take(marks);
  };
  /** Types a value over the one a field holds. */
  const typed = async (field: Locator, value: string): Promise<void> => {
    await field.fill(value);
    await field.press("Enter");
    await expect(field).toHaveValue(value);
  };
  /** Takes a frame halfway to a control, then scrolls the panel to the control. */
  const down = async (name: string, to: Locator): Promise<void> => {
    const from = await panel.scrolled();
    const at = await panel.scrollTo(to);
    await reel.scrolledTo(scroller, name, (from + at) / 2);
    await panel.scrollTo(to);
  };

  // The page and its text: a smaller trim, and smaller type on it.
  const page = { trim: panel.control("trim"), "body-size": panel.control("body-size") };
  await take(page);
  await step(async () => {
    await panel.control("trim").selectOption(TRIM);
  }, page);
  await step(async () => typed(panel.control("body-size"), BODY_SIZE), page);

  // The chapter's title is a first-level heading.
  const title = {
    "h1-font": panel.control("heading-1-font"),
    "h1-center": panel.choice("heading-1-align", "center"),
    "h1-below": panel.up("heading-1-space-below"),
    h2: panel.choice("heading-level", "2"),
  };
  await down("scroll-headings", panel.control("heading-1-size"));
  await take(title);
  // The picker, open on the faces the filter leaves.
  await panel.control("heading-1-font").click();
  await expect(panel.filter).toBeVisible();
  await panel.type(TITLE_FILTER);
  await expect(panel.option(TITLE_FONT)).toBeVisible();
  await take({ ...title, option: panel.option(TITLE_FONT) }, true);
  await step(async () => {
    await panel.option(TITLE_FONT).click();
    await expect(panel.control("heading-1-font")).toContainText(TITLE_FONT);
  }, title);
  await step(async () => panel.choice("heading-1-align", "center").click(), title);
  await step(async () => panel.up("heading-1-space-below").click(), title);

  // The line over it is a second-level heading, which the same rows set.
  const line = {
    "h2-size": panel.control("heading-2-size"),
    "h2-center": panel.choice("heading-2-align", "center"),
  };
  await panel.choice("heading-level", "2").click();
  await expect(panel.control("heading-2-size")).toBeVisible();
  await take(line);
  await step(async () => typed(panel.control("heading-2-size"), LINE_SIZE), line);
  await step(async () => panel.choice("heading-2-align", "center").click(), line);

  // The chapter's first letter and its first line.
  const opening = {
    "drop-cap": panel.control("chapter-drop-cap"),
    "first-line": panel.control("chapter-first-line-caps"),
  };
  await down("scroll-openings", panel.control("chapter-drop-cap-font"));
  await take(opening);
  await step(async () => {
    await panel.control("chapter-drop-cap").selectOption({ label: "3 lines" });
  }, opening);
  await step(async () => {
    await panel.control("chapter-first-line-caps").selectOption({ label: "Small caps" });
  }, opening);

  // One app runs every take of a shard, so the panel goes back as well.
  await panel.choice("heading-level", "1").click();
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await reel.end();
});

// What this spec does not cover: whether the player shows each frame
// where its marks put it, which a look at the landing page answers; the
// menu a native select opens, which is the system's and is in no
// picture of the window; the frames on any platform but the one they
// were taken on; and a book whose chapter moves off its folio, which
// stops the take rather than being set right.
