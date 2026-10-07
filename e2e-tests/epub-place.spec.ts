/**
 * The EPUB view turned to a place: by the chapter select, the chapter
 * commands, the navigator, a swap with the manuscript, a switch with a
 * page view, and a manuscript linked to the pane. Each is a direction
 * the page views' specs cover for a page.
 */

import { NEXT_CHAPTER, PREVIOUS_CHAPTER, type Book } from "./harness/book";
import type { Epub } from "./harness/epub";
import { expect, test } from "./harness/test";
import type { Vault } from "./harness/vault";

/** The book note in the fixture vault, and the chapter it has a note for. */
const BOOK = "Pride and Prejudice.md";
const CHAPTER = "Chapter Twelve.md";

/** The sections the book is set from, as the chapter select names them. */
const TITLE_PAGE = "Title page";
const CONTENTS = "Contents";
const CHAPTER_NAME = "Chapter Twelve";
const SECOND_NAME = "Chapter Fifteen";
const LAST = "Acknowledgements";

/** The words the generated title page opens on. */
const SERIES = "The Bennet Novels";

/** The line the fixture chapter's own heading is on, counting from 0. */
const HEADING = 5;

/** The line a paragraph opens on, counting from 0. */
function lineOf(text: string, opening: string): number {
  return text.split("\n").findIndex((line) => line.startsWith(opening));
}

/**
 * Lengthens the chapter to forty numbered paragraphs and puts the book
 * back on the shelf, so a screen inside the chapter has a paragraph to
 * be named by.
 */
async function pagedOut(vault: Vault): Promise<string> {
  const said = Array.from(
    { length: 40 },
    (_, at) => `Paragraph ${String(at + 1)}. ${"And so the evening passed. ".repeat(12)}`,
  );
  const text = `${await vault.read(CHAPTER)}\n\n${said.join("\n\n")}\n`;
  await vault.modify(CHAPTER, text);
  await vault.modify(BOOK, await vault.read(BOOK));
  return text;
}

/** The numbers of the paragraphs in these words. */
function numbers(words: string[]): number[] {
  return words.flatMap((each) => {
    const found = /^Paragraph (\d+)\./.exec(each);
    return found === null ? [] : [Number(found[1])];
  });
}

/** The paragraphs that begin on the screen, by the number each opens with. */
async function paragraphsOn(epub: Epub): Promise<number[]> {
  return numbers(await epub.begins());
}

/** The paragraphs the page on screen sets, by the number each opens with. */
async function paragraphsOnPage(book: Book): Promise<number[]> {
  return [...(await book.words(0)).matchAll(/Paragraph (\d+)\./g)].map((found) =>
    Number(found[1]),
  );
}

/** Turns one screen on, and waits for the pane to take its place. */
async function turned(epub: Epub): Promise<void> {
  await epub.turn();
  await epub.taken();
}

test("in the EPUB view the toolbar names the chapter on screen, a choice turns the frame to that chapter's first screen, and a turn renames it", async ({
  book,
  epub,
}) => {
  await book.open();
  await book.settled(BOOK);
  await epub.open();

  // The book opens on its title page, which is a section like any
  // other, so the control is there and names it.
  await expect(book.chapter).toBeVisible();
  await expect(book.chapterName).toHaveText(TITLE_PAGE);

  await book.choose(SECOND_NAME);
  await expect.poll(async () => epub.heading()).toBe(SECOND_NAME);
  await expect(epub.view).toHaveAttribute("data-screen", "1");
  await expect(book.chapterName).toHaveText(SECOND_NAME);

  // A turn back off the chapter's first screen is into the chapter
  // before it, and the control follows.
  await epub.previous.click();
  await expect.poll(async () => epub.heading()).toBe(CHAPTER_NAME);
  await expect(book.chapterName).toHaveText(CHAPTER_NAME);

  // A chapter chosen from its own last screen opens at its first.
  expect((await epub.turned()).screen).toBeGreaterThan(1);
  await book.choose(SECOND_NAME);
  await book.choose(CHAPTER_NAME);
  await expect.poll(async () => epub.heading()).toBe(CHAPTER_NAME);
  await expect(epub.view).toHaveAttribute("data-screen", "1");
});

test("the title page and the contents are found as chapters are", async ({
  book,
  epub,
  navigator,
}) => {
  await book.open();
  await book.settled(BOOK);
  await epub.open();

  await book.choose(CONTENTS);
  await expect.poll(async () => epub.heading()).toBe(CONTENTS);
  await expect(book.chapterName).toHaveText(CONTENTS);

  await navigator.reveal();
  await navigator.entry(BOOK, TITLE_PAGE).click();
  await expect.poll(async () => epub.words()).toContain(SERIES);
  await expect(book.chapterName).toHaveText(TITLE_PAGE);
  await expect(epub.view).toHaveAttribute("data-section", "1");
});

test("next chapter and previous chapter turn the frame, and go quiet at the ends", async ({
  book,
  epub,
  obsidian,
}) => {
  await book.open();
  await book.settled(BOOK);
  await epub.open();
  await book.choose(CHAPTER_NAME);
  await expect.poll(async () => epub.heading()).toBe(CHAPTER_NAME);

  await obsidian.command(NEXT_CHAPTER);
  await expect.poll(async () => epub.heading()).toBe(SECOND_NAME);
  await expect(book.chapterName).toHaveText(SECOND_NAME);

  await obsidian.command(NEXT_CHAPTER);
  await expect.poll(async () => epub.heading()).toBe(LAST);
  await expect(book.chapterName).toHaveText(LAST);

  // The last section has nothing after it, so the command is not there
  // to run.
  expect(await obsidian.offers(NEXT_CHAPTER)).toBe(false);

  await obsidian.command(PREVIOUS_CHAPTER);
  await expect.poll(async () => epub.heading()).toBe(SECOND_NAME);
  await expect(epub.view).toHaveAttribute("data-screen", "1");
  await expect(book.chapterName).toHaveText(SECOND_NAME);
});

test("a chapter click in the navigator turns the frame, and the navigator marks the chapter being read", async ({
  book,
  epub,
  navigator,
}) => {
  await book.open();
  await book.settled(BOOK);
  await epub.open();
  await navigator.reveal();

  await navigator.entry(BOOK, CHAPTER_NAME).click();
  await expect.poll(async () => epub.heading()).toBe(CHAPTER_NAME);
  await expect(epub.view).toHaveAttribute("data-screen", "1");
  await expect(navigator.entry(BOOK, CHAPTER_NAME)).toHaveAttribute("aria-current", "page");

  // A turn of the frame into the next chapter moves the mark with it.
  await book.choose(SECOND_NAME);
  await expect(navigator.entry(BOOK, SECOND_NAME)).toHaveAttribute("aria-current", "page");
  await epub.previous.click();
  await expect(navigator.entry(BOOK, CHAPTER_NAME)).toHaveAttribute("aria-current", "page");
  await expect(navigator.entry(BOOK, SECOND_NAME)).not.toHaveAttribute("aria-current", "page");
});

test("a swap from the manuscript opens the EPUB view on the screen that holds the line it showed, and paging takes the swap back to the line the screen opens at", async ({
  book,
  epub,
  manuscript,
  vault,
}) => {
  const text = await pagedOut(vault);
  const deep = lineOf(text, "Paragraph 20.");

  // The EPUB view is the machine's, so the next preview opens in it.
  await manuscript.open(CHAPTER);
  await manuscript.asBook.click();
  await book.painted();
  await epub.open();
  await book.asMarkdown.click();
  await expect(manuscript.pane).toHaveCount(1);

  await manuscript.scrollTo(deep);
  await manuscript.asBook.click();
  await epub.painted();
  await epub.taken();
  expect(await paragraphsOn(epub)).toContain(20);

  await turned(epub);
  await turned(epub);
  const opens = (await paragraphsOn(epub))[0];
  expect(opens).toBeGreaterThan(20);

  await book.asMarkdown.click();
  await expect(manuscript.pane).toHaveCount(1);
  // The reader paged through, so the pane comes back to the line the
  // screen opens at, with the caret on it to write from.
  const line = lineOf(text, `Paragraph ${String(opens)}.`);
  await expect.poll(async () => (await manuscript.caret())?.line).toBe(line);
  // A pane Obsidian has just rebuilt settles its own scroll around the
  // caret, so the pane is held to being past where it was left.
  await expect.poll(async () => manuscript.scroll()).toBeGreaterThan(deep);

  // The line is where that screen opens, so the swap in lands on it.
  await manuscript.asBook.click();
  await epub.painted();
  await epub.taken();
  expect((await paragraphsOn(epub))[0]).toBe(opens);
});

test("and a reader who only looked at the EPUB view comes back to the line they were on", async ({
  book,
  epub,
  manuscript,
  vault,
}) => {
  await pagedOut(vault);

  await manuscript.open(CHAPTER);
  await manuscript.asBook.click();
  await book.painted();
  await epub.open();
  await book.asMarkdown.click();
  await expect(manuscript.pane).toHaveCount(1);

  await manuscript.place({ line: HEADING + 2, ch: 3 });
  await manuscript.asBook.click();
  await epub.painted();
  await epub.taken();

  await book.asMarkdown.click();
  await expect(manuscript.pane).toHaveCount(1);
  await expect.poll(async () => manuscript.caret()).toEqual({
    line: HEADING + 2,
    ch: 3,
  });
});

test("a switch to the EPUB view lands on the screen that holds what the page opens with, and a switch back lands on the page that holds what the screen opens with", async ({
  book,
  epub,
  vault,
}) => {
  await pagedOut(vault);
  await book.open();
  await book.settled(BOOK);
  await book.show("Single page", "single");
  await book.choose(CHAPTER_NAME);
  await expect(book.surface).toHaveAttribute("data-note", CHAPTER);
  // The chapter's own pages come first, so the book is turned on to
  // the first page that opens past the first of the paragraphs.
  let at = await book.reading();
  let page: number | undefined;
  while (page === undefined || page < 2) {
    at += 1;
    await book.next.click();
    await expect(book.surface).toHaveAttribute("data-first", String(at));
    page = (await paragraphsOnPage(book))[0];
  }

  await epub.open();
  await epub.taken();
  expect(await paragraphsOn(epub)).toContain(page);

  // A reader who turned no screen goes back to the page they left.
  await book.show("Single page", "single");
  await expect(book.surface).toHaveAttribute("data-first", String(at));

  await epub.open();
  await epub.taken();
  await turned(epub);
  await turned(epub);
  await turned(epub);
  const screen = (await paragraphsOn(epub))[0];
  expect(screen).toBeGreaterThan(page);

  await book.show("Single page", "single");
  await expect.poll(async () => paragraphsOnPage(book)).toContain(screen);
});

test("a linked manuscript follows a screen turn to the line that screen opens at, and the frame follows the manuscript to the screen that holds the line it is scrolled to", async ({
  book,
  epub,
  manuscript,
  vault,
}) => {
  const text = await pagedOut(vault);

  await manuscript.open(CHAPTER);
  await manuscript.scrollTo(HEADING);
  await book.split();
  await book.painted();
  await epub.open();
  await epub.taken();
  await expect(manuscript.pane).toHaveCount(1);
  await expect(epub.host).toHaveAttribute("data-note", CHAPTER);

  // Two screens on, the manuscript is at the line the screen opens at.
  await turned(epub);
  await turned(epub);
  await expect(epub.host).toHaveAttribute("data-led", CHAPTER);
  const opens = (await paragraphsOn(epub))[0];
  expect(opens).toBeGreaterThan(1);
  const line = lineOf(text, `Paragraph ${String(opens)}.`);
  await expect.poll(async () => manuscript.scroll()).toBe(line);
  // The scroll that answered the turn turned the frame nowhere.
  expect((await paragraphsOn(epub))[0]).toBe(opens);

  // The manuscript scrolled on, and the frame goes to the screen that
  // holds the line at the top of the pane.
  await manuscript.scrollTo(lineOf(text, "Paragraph 30."));
  await expect.poll(async () => paragraphsOn(epub)).toContain(30);

  // And back up the chapter, to its heading.
  await manuscript.scrollTo(HEADING);
  await expect(epub.view).toHaveAttribute("data-screen", "1");
  await expect.poll(async () => epub.heading()).toBe(CHAPTER_NAME);
});

// What this spec does not cover: a heading click in the navigator, which
// turns the frame by the same byte a line of the manuscript does, and
// the heading row it marks. A turn asked for while an edit is still
// being set is kept for the next screen, and nothing here edits while
// it turns. The view on a phone and a tablet is `mobile-epub.spec.ts`'s.
// A link inside the frame is not followed.
