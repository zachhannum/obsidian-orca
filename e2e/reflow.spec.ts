/**
 * A book set in another font repaginates all of it, and every surface
 * that names a page has to ask again. A reflow moves the folio, so the
 * assertions here are on the words a page carries.
 */

import type { Book } from "./harness/book";
import type { Panel } from "./harness/panel";
import { expect, test } from "./harness/test";
import type { Vault } from "./harness/vault";

/** The book note in the fixture vault, and the chapter it reads. */
const BOOK = "Pride and Prejudice.md";
const CHAPTER = "Chapter Twelve.md";
const LAST_NOTE = "Acknowledgements.md";

/** The font the fixture vault ships, which a pick sets the book in. */
const FONT = "Alegreya";

/** The chapters either side of the reflow, as the toolbar names them. */
const CHAPTER_NAME = "Chapter Twelve";
const LAST = "Acknowledgements";

/** The words the last section is set from, which name its page. */
const LAST_WORDS = "For the readers who took the chapters";

/** The line the fixture chapter's own heading is on, counting from 0. */
const HEADING = 5;

/** The paragraphs the chapter is lengthened to, and the last of them. */
const PARAGRAPHS = 60;
const DEEP = `Paragraph ${String(PARAGRAPHS)}.`;

/**
 * The chapter with paragraphs enough to run over several pages, each
 * one numbered so a spec can name the page it is set on. The prose is
 * the chapter's own, cycled: a font repaginates a book by breaking its
 * lines differently, and one sentence repeated breaks the same in every
 * font.
 */
function lengthened(chapter: string): string {
  const parts = chapter.split("\n\n");
  const prose = parts.slice(2);
  const said = Array.from(
    { length: PARAGRAPHS },
    (_, at) =>
      `Paragraph ${String(at + 1)}. ${prose[at % prose.length] ?? ""}`,
  );
  return `${parts.slice(0, 2).join("\n\n")}\n\n${said.join("\n\n")}\n`;
}

/** The line a paragraph opens on, counting from 0. */
function lineOf(text: string, opening: string): number {
  return text.split("\n").findIndex((line) => line.startsWith(opening));
}

/**
 * Lengthens the chapter and puts the book back on the shelf. A book is
 * typeset once a session, and it is the book note that takes it off, so
 * this is what makes a pane open on a book set from the chapter as it
 * now is.
 */
async function pagedOut(vault: Vault): Promise<string> {
  const text = lengthened(await vault.read(CHAPTER));
  await vault.modify(CHAPTER, text);
  await vault.modify(BOOK, await vault.read(BOOK));
  return text;
}

/** Sets the book in the fixture's own font, and waits for the pages it made. */
async function refont(panel: Panel, book: Book, painted: number): Promise<void> {
  await panel.open();
  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FONT }).first().click();
  await expect(panel.font).toContainText(FONT);
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
}

test("a reflow turns the pane to the page its content moved to", async ({
  book,
  panel,
  vault,
}) => {
  await pagedOut(vault);
  await book.open();
  const painted = await book.painted();

  // The back matter is at the end of the book, where every page a new
  // font gains or loses has accumulated.
  await book.choose(LAST);
  await expect(book.page).toContainText(LAST_WORDS);
  const was = await book.reading();

  await refont(panel, book, painted);

  // Nothing turned the page, and the pane is on the words it was
  // reading rather than on the page number it was on.
  await expect(book.page).toContainText(LAST_WORDS);
  expect(await book.reading()).not.toBe(was);
  await expect(book.chapterName).toHaveText(LAST);
});

test("a reflow that leaves the content where it was turns nothing", async ({
  book,
  panel,
  vault,
}) => {
  await pagedOut(vault);
  await book.open();
  const painted = await book.painted();

  // The title page opens the book, so nothing ahead of it can move it.
  await expect(book.surface).toHaveAttribute("data-first", "1");

  await refont(panel, book, painted);

  await expect(book.surface).toHaveAttribute("data-first", "1");
});

test("a manuscript read after a reflow turns the pane to the page that line is now on", async ({
  book,
  manuscript,
  panel,
  vault,
}) => {
  const text = await pagedOut(vault);
  const deep = lineOf(text, DEEP);

  await manuscript.open(CHAPTER);
  await book.split();
  const painted = await book.painted();
  // The back matter is where the pages a new font gains have all
  // accumulated, so it is the note whose page moves.
  await manuscript.moveTo(LAST_NOTE);
  await expect(book.page).toContainText(LAST_WORDS);
  const was = await book.reading();

  await refont(panel, book, painted);

  // The manuscript moves away and back. The folio that line is set on
  // is asked for after the reflow, so the pane lands on the words
  // rather than on where they used to be.
  await manuscript.moveTo(CHAPTER);
  await manuscript.scrollTo(deep);
  await expect(book.page).toContainText(DEEP);
  await manuscript.moveTo(LAST_NOTE);
  await expect(book.page).toContainText(LAST_WORDS);
  expect(await book.reading()).not.toBe(was);
});

test("a page turned after a reflow scrolls the manuscript to the line it now opens at", async ({
  book,
  manuscript,
  panel,
  vault,
}) => {
  await pagedOut(vault);

  await manuscript.open(CHAPTER);
  await manuscript.scrollTo(HEADING);
  await book.split();
  const painted = await book.painted();

  await refont(panel, book, painted);

  await book.next.click();
  await expect(book.surface).toHaveAttribute("data-led", CHAPTER);
  await expect.poll(async () => manuscript.scroll()).toBeGreaterThan(HEADING);
});

test("a chapter chosen after a reflow turns to the page it now opens on", async ({
  book,
  panel,
  vault,
}) => {
  await pagedOut(vault);
  await book.open();
  const painted = await book.painted();

  await book.choose(LAST);
  await expect(book.page).toContainText(LAST_WORDS);
  const was = await book.reading();

  await refont(panel, book, painted);

  await book.choose(CHAPTER_NAME);
  await expect(book.page).toContainText(CHAPTER_NAME);
  await expect(book.chapterName).toHaveText(CHAPTER_NAME);
  await book.choose(LAST);

  // The last section moved with every page the reflow gained ahead of
  // it, and the turn goes to where it opens now.
  await expect(book.page).toContainText(LAST_WORDS);
  await expect(book.chapterName).toHaveText(LAST);
  expect(await book.reading()).not.toBe(was);
});

// What this suite does not cover: that the node the pane follows costs
// no page over the wire, which is the shape of the call rather than
// something the window shows.
