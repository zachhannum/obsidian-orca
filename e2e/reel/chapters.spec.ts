import type { Locator } from "@playwright/test";
import { AS_BOOK, AS_MARKDOWN, BOOK as PAGE, MARKDOWN, Note } from "../harness/note";
import { expect, test } from "../harness/test";

/** The folder the sample book keeps its notes in, the book note, and the chapter the pointer rests on. */
const FOLDER = "Twenty Thousand Leagues";
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const CHAPTER = "A Shifting Reef";

/** The folio the chapter's spread opens on when the session is sound. */
const OPENS = 8;

/** The navigator's width. */
const NAVIGATOR = 300;

/** The first heading of the reading order as the note writes it, and the room left above it. */
const ORDER = "# Front matter";
const ABOVE = 24;

/** The room left above the reading order on the book note's page. */
const ABOVE_PAGE = 56;

/** The box a note's Markdown scrolls in, and the link a chapter is in source mode. */
const SCROLLER = ".cm-scroller";
const LINK = ".cm-hmd-internal-link";

test("the chapters reel is the book note as its page and as its Markdown", async ({ reel }) => {
  const { site } = reel;
  const { obsidian } = site;
  const note = new Note(obsidian);
  await reel.begin({ book: BOOK, chapter: CHAPTER, folio: OPENS });

  // One app runs every take of a shard, so the sidebars and the way a
  // note is read go back when the take ends, however it ends.
  const left = await obsidian.collapsed("left");
  const right = await obsidian.collapsed("right");
  await site.navigator.reveal();
  const width = await obsidian.sidebar(NAVIGATOR, "left");
  try {
    await obsidian.put("right");
    await expect(site.navigator.book(BOOK)).toHaveCount(1);
    // The switch to Markdown opens the editor the way the vault reads a
    // note, so that is set before the click and the click is all there is.
    await obsidian.asSource();

    /** Scrolls a scroller and takes a frame there, with the scroller and these targets as its marks. */
    const at = async (
      name: string,
      scroller: Locator,
      top: number,
      targets: Record<string, Locator>,
      drawn: () => Promise<void> = async () => {},
    ): Promise<void> => {
      await scroller.evaluate((element, to) => {
        element.scrollTop = to;
      }, top);
      await drawn();
      expect(await scroller.evaluate((element) => element.scrollTop)).toBe(top);
      await reel.frame(name, { scroller, ...targets }, { scroll: scroller });
    };
    /** The offsets a scroll passes from the top to `end`, with one frame between that overlaps both. */
    const stops = async (scroller: Locator, end: number): Promise<[number, number, number]> => {
      const tall = await scroller.evaluate((element) => element.clientHeight);
      const middle = Math.round(end / 2);
      expect(end - middle, "the frame between overlaps the two ends").toBeLessThan(tall);
      return [0, middle, end];
    };

    // The book note as its page, down to the reading order.
    await note.open(BOOK);
    await note.painted();
    const page = obsidian.content(PAGE);
    const toMarkdown = { "as-markdown": obsidian.actionIn(PAGE, AS_MARKDOWN) };
    const order = await note.order.evaluate(
      (list, scroller) =>
        scroller === null
          ? 0
          : list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop,
      await page.elementHandle(),
    );
    const down = await stops(page, Math.round(order - ABOVE_PAGE));
    await at("page", page, down[0], toMarkdown);
    await at("page-mid", page, down[1], toMarkdown);
    await at("page-order", page, down[2], toMarkdown);
    await expect(note.entry(CHAPTER)).toBeInViewport();

    // The same note as the text on disk, from the header's own action.
    await obsidian.actionIn(PAGE, AS_MARKDOWN).click();
    const source = obsidian.view(MARKDOWN);
    const lines = source.locator(SCROLLER);
    await expect(source).toContainText("orca-book: 1");
    /**
     * Waits for the editor to draw every line in sight. It draws only
     * the lines near the view and leaves a gap for the rest, and a
     * scroll is answered a frame later.
     */
    const drawn = async (): Promise<void> => {
      await expect
        .poll(async () =>
          lines.evaluate((scroller) => {
            const seen = scroller.getBoundingClientRect();
            return [...scroller.querySelectorAll(".cm-gap")].some((gap) => {
              const box = gap.getBoundingClientRect();
              return box.bottom > seen.top && box.top < seen.bottom;
            });
          }),
        )
        .toBe(false);
    };
    // The editor guesses the height of a line it has not drawn, so the
    // note is walked down once before any offset is read off it.
    await obsidian.scrollTo(ORDER);
    await drawn();
    const heading = source.locator(".cm-line", { hasText: ORDER });
    await expect(heading).toBeVisible();
    const first = await lines.evaluate(
      (scroller, line) =>
        line === null
          ? 0
          : line.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop,
      await heading.elementHandle(),
    );
    const up = await stops(lines, Math.round(first - ABOVE));
    const toBook = { "as-book": obsidian.actionIn(MARKDOWN, AS_BOOK) };
    const link = source.locator(".cm-line", { hasText: `[[${CHAPTER}]]` }).locator(LINK);
    await at("source-order", lines, up[2], { ...toBook, link }, drawn);
    await expect(source).toContainText("# Body");
    await expect(link).toBeInViewport();
    await at("source-mid", lines, up[1], toBook, drawn);
    await at("source-top", lines, up[0], toBook, drawn);
    await expect(source.locator(".cm-line", { hasText: "trim:" })).toBeInViewport();

    // Back to the page, which is where the reel starts again.
    await obsidian.actionIn(MARKDOWN, AS_BOOK).click();
    await expect(note.page).toBeVisible();
    await reel.end();
  } finally {
    await obsidian.asRendered();
    await obsidian.sidebar(width, "left");
    if (left) await obsidian.put("left");
    if (!right) await obsidian.expand("right");
  }
});

// What this spec does not cover: whether the player tiles the scrolled
// frames into one strip, which a look at the landing page answers; the
// frames on any platform but the one they were taken on; a book note
// whose properties run past the first two frames, which the frame
// between would no longer overlap; and the pointer, which the player
// draws itself because a picture of the window holds none.
