import { NOWHERE, SPLIT } from "./harness/book";
import { expect, test } from "./harness/test";
import type { Vault } from "./harness/vault";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The chapter the fixture has a note for, and the last note the book reads. */
const CHAPTER = "Chapter Twelve.md";
const LAST = "Acknowledgements.md";

/** A note no book in the fixture reads. */
const OUTSIDE = "Loose.md";

/** The sections the fixture book is set from: eight entries, one with no note. */
const SECTIONS = 7;

/** The line the fixture chapter's own heading is on, counting from 0. */
const HEADING = 5;

/**
 * The chapter with paragraphs enough to run over several pages, so a
 * caret has somewhere inside it to be.
 */
function lengthened(chapter: string): string {
  const said = Array.from(
    { length: 40 },
    (_, at) =>
      `Paragraph ${String(at + 1)}. ${"And so the evening passed. ".repeat(12)}`,
  );
  return `${chapter}\n\n${said.join("\n\n")}\n`;
}

/** The line a paragraph opens on, counting from 0. */
function lineOf(text: string, opening: string): number {
  return text.split("\n").findIndex((line) => line.startsWith(opening));
}

/**
 * Lengthens the chapter and puts the book back on the shelf. A book is
 * typeset once a session, and it is the book note that takes it off,
 * so this is what makes a pane open on a book set from the chapter as
 * it now is.
 */
async function pagedOut(vault: Vault): Promise<string> {
  const text = lengthened(await vault.read(CHAPTER));
  await vault.modify(CHAPTER, text);
  await vault.modify(BOOK, await vault.read(BOOK));
  return text;
}

test("the icon opens a note as the book, and only a note that belongs to one", async ({
  book,
  manuscript,
  vault,
}) => {
  await vault.write(OUTSIDE, "# Loose\n\nA note no book reads.\n");
  await manuscript.open(OUTSIDE);
  await expect(manuscript.pane).toHaveCount(1);
  await expect(manuscript.asBook).toHaveCount(0);

  await manuscript.open(CHAPTER);
  await expect(manuscript.asBook).toHaveCount(1);

  await manuscript.asBook.click();
  expect(await book.painted()).toBeGreaterThan(0);
  // The same pane, swapped: the book took the manuscript's place rather
  // than opening beside it.
  await expect(manuscript.pane).toHaveCount(0);
});

test("the book opens turned to the first page of the chapter the writer was in", async ({
  book,
  manuscript,
  note,
}) => {
  await note.open(BOOK);
  await expect(note.pages("Chapter Twelve")).toHaveText(/\d/);
  const range = (await note.pages("Chapter Twelve").textContent()) ?? "";
  const opens = Number(range.split("–")[0]);
  expect(opens).toBeGreaterThan(1);

  await manuscript.open(CHAPTER);
  await manuscript.asBook.click();
  await book.painted();

  // A chapter typeset by itself is a different chapter, so the page
  // is the one the whole book put it on.
  await expect(book.surface).toHaveAttribute("data-first", String(opens));
});

test("toggling back returns to the manuscript, on the line it was left on", async ({
  book,
  manuscript,
}) => {
  await manuscript.open(CHAPTER);
  await manuscript.place({ line: 10, ch: 4 });

  await manuscript.asBook.click();
  await book.painted();

  await book.asMarkdown.click();
  await expect(manuscript.pane).toHaveCount(1);
  await expect.poll(async () => manuscript.caret()).toEqual({
    line: 10,
    ch: 4,
  });
});

test("`Open preview to the right` splits, and the manuscript follows the book", async ({
  book,
  manuscript,
}) => {
  await manuscript.open(CHAPTER);
  await book.split();
  await book.painted();

  // A split rather than a swap: the manuscript stays, and the book is
  // beside it, opened at the chapter the writer was in.
  await expect(manuscript.pane).toHaveCount(1);
  await expect(book.panes).toHaveCount(1);
  await expect(book.surface).toHaveAttribute("data-note", CHAPTER);

  // Turning to the end of the book takes the manuscript to the note the
  // book ends on.
  await book.press("End");
  await expect(book.surface).toHaveAttribute("data-note", LAST);
  await expect.poll(async () => manuscript.showing()).toEqual([LAST]);
});

test("and the book follows the manuscript, to the page it is scrolled to", async ({
  book,
  manuscript,
}) => {
  await manuscript.open(CHAPTER);
  await book.split();
  await book.painted();
  const opens = await book.reading();
  expect(opens).toBeGreaterThan(1);

  await manuscript.moveTo(LAST);
  await expect(book.surface).toHaveAttribute("data-note", LAST);

  await manuscript.moveTo(CHAPTER);
  await manuscript.scrollTo(HEADING);
  await expect(book.surface).toHaveAttribute("data-note", CHAPTER);
  // The page that heading is set on, rather than whichever of the
  // chapter's pages the book happened to be turned to.
  await expect(book.surface).toHaveAttribute("data-first", String(opens));
});

test("a chapter's own menu offers the split, and a note outside a book does not", async ({
  book,
  manuscript,
  obsidian,
  vault,
}) => {
  await vault.write(OUTSIDE, "# Loose\n\nA note no book reads.\n");
  await manuscript.open(OUTSIDE);
  expect(await obsidian.fileMenu(OUTSIDE)).not.toContain(SPLIT);

  expect(await obsidian.fileMenu(CHAPTER)).toContain(SPLIT);
  await obsidian.fileMenu(CHAPTER, SPLIT);

  await book.painted();
  await expect(manuscript.pane).toHaveCount(1);
  await expect(book.panes).toHaveCount(1);
  await expect(book.surface).toHaveAttribute("data-note", CHAPTER);
});

test("`Open manuscript to the left` makes the same split from the book's side", async ({
  book,
  manuscript,
}) => {
  await manuscript.open(CHAPTER);
  await manuscript.asBook.click();
  await book.painted();
  await expect(manuscript.pane).toHaveCount(0);

  await book.manuscriptBeside();
  await expect(manuscript.pane).toHaveCount(1);
  await expect.poll(async () => manuscript.showing()).toEqual([CHAPTER]);

  // Tied both ways from here, the same as a split made from the
  // manuscript.
  await book.press("End");
  await expect(book.surface).toHaveAttribute("data-note", LAST);
  await expect.poll(async () => manuscript.showing()).toEqual([LAST]);
});

test("a linked pane follows what is scrolled into view, paragraph by paragraph", async ({
  book,
  manuscript,
  vault,
}) => {
  const text = await pagedOut(vault);
  const deep = lineOf(text, "Paragraph 40.");

  await manuscript.open(CHAPTER);
  await book.split();
  await book.painted();
  const opens = await book.reading();

  // The chapter runs over several pages now, and scrolling to the end
  // of it turns the pane to the page that one paragraph is set on.
  await manuscript.scrollTo(deep);
  await expect(book.surface).toHaveAttribute("data-note", CHAPTER);
  await expect.poll(async () => book.reading()).toBeGreaterThan(opens);
  const far = await book.reading();

  // Back to the chapter's own heading, and back again, inside the one
  // chapter both times.
  await manuscript.scrollTo(HEADING);
  await expect(book.surface).toHaveAttribute("data-first", String(opens));
  await manuscript.scrollTo(deep);
  await expect(book.surface).toHaveAttribute("data-first", String(far));
});

test("and a linked manuscript follows a page turn to the line that page opens at", async ({
  book,
  manuscript,
  vault,
}) => {
  await pagedOut(vault);

  await manuscript.open(CHAPTER);
  await manuscript.scrollTo(HEADING);
  await book.split();
  await book.painted();
  const opens = await book.reading();

  await book.next.click();
  await expect(book.surface).toHaveAttribute("data-first", String(opens + 1));
  await expect(book.surface).toHaveAttribute("data-led", CHAPTER);
  await expect.poll(async () => manuscript.scroll()).toBeGreaterThan(HEADING);
  const on = await manuscript.scroll();

  // The page before it opens further back up the chapter, and the
  // manuscript goes back with it.
  await book.previous.click();
  await expect(book.surface).toHaveAttribute("data-first", String(opens));
  await expect.poll(async () => manuscript.scroll()).toBeLessThan(on);
});

test("the preview keeps the page a swap left it on, mid-chapter included", async ({
  book,
  manuscript,
  vault,
}) => {
  await pagedOut(vault);

  await manuscript.open(CHAPTER);
  await manuscript.asBook.click();
  await book.painted();
  const opens = await book.reading();

  // Paged into the middle of the chapter, rather than left where the
  // toggle opened it.
  await book.next.click();
  await expect(book.surface).toHaveAttribute("data-first", String(opens + 1));

  const swap = async (): Promise<void> => {
    await book.asMarkdown.click();
    await expect(manuscript.pane).toHaveCount(1);
    await manuscript.asBook.click();
    await book.painted();
    await expect(book.surface).toHaveAttribute("data-first", String(opens + 1));
  };
  await swap();
  await swap();
});

test("the toggle opens the book at the page the manuscript is scrolled to", async ({
  book,
  manuscript,
  vault,
}) => {
  const text = await pagedOut(vault);
  const deep = lineOf(text, "Paragraph 40.");

  await manuscript.open(CHAPTER);
  await manuscript.asBook.click();
  await book.painted();
  const opens = await book.reading();

  await book.asMarkdown.click();
  await expect(manuscript.pane).toHaveCount(1);
  await manuscript.scrollTo(deep);
  await manuscript.asBook.click();
  await book.painted();

  // The manuscript scrolled since the swap, so the page the book was
  // left on gives way to the page that paragraph is set on.
  await expect.poll(async () => book.reading()).toBeGreaterThan(opens);
});

test("paging through the book takes the swap back to the line that page opens at", async ({
  book,
  manuscript,
  vault,
}) => {
  await pagedOut(vault);

  await manuscript.open(CHAPTER);
  await manuscript.scrollTo(HEADING);
  await manuscript.asBook.click();
  await book.painted();
  const opens = await book.reading();

  await book.next.click();
  await expect(book.surface).toHaveAttribute("data-first", String(opens + 1));

  await book.asMarkdown.click();
  await expect(manuscript.pane).toHaveCount(1);
  // The reader paged through, so the pane comes back to the line that
  // page opens at, with the caret on it to write from.
  await expect.poll(async () => manuscript.scroll()).toBeGreaterThan(HEADING);
  await expect
    .poll(async () => (await manuscript.caret())?.line ?? 0)
    .toBeGreaterThan(HEADING);
});

test("and a reader who only looked comes back to the line they were on", async ({
  book,
  manuscript,
  vault,
}) => {
  await pagedOut(vault);

  await manuscript.open(CHAPTER);
  await manuscript.place({ line: HEADING + 2, ch: 3 });
  await manuscript.asBook.click();
  await book.painted();

  await book.asMarkdown.click();
  await expect(manuscript.pane).toHaveCount(1);
  await expect.poll(async () => manuscript.caret()).toEqual({
    line: HEADING + 2,
    ch: 3,
  });
});

test("a workspace reopened on a preview opens it at the page it was closed on", async ({
  book,
  manuscript,
  obsidian,
  vault,
}) => {
  await pagedOut(vault);

  await manuscript.open(CHAPTER);
  await manuscript.asBook.click();
  await book.painted();
  const opens = await book.reading();
  await book.next.click();
  await expect(book.surface).toHaveAttribute("data-first", String(opens + 1));

  const layout = await obsidian.layout();
  await book.close();
  await expect(book.panes).toHaveCount(0);
  await obsidian.reopen(layout);

  await expect(book.panes).toHaveCount(1);
  await book.painted();
  await expect(book.surface).toHaveAttribute("data-first", String(opens + 1));
});

test("a note the book does not list, and a page orca wrote, turn neither pane", async ({
  book,
  manuscript,
  vault,
}) => {
  await vault.write(OUTSIDE, "# Loose\n\nA note no book reads.\n");
  await manuscript.open(CHAPTER);
  await book.split();
  await book.painted();
  const on = await manuscript.scroll();

  // The title page was written by orca rather than by anyone, so the
  // pane says it led the manuscript nowhere.
  await book.type("1");
  await expect(book.surface).toHaveAttribute("data-first", "1");
  await expect(book.surface).toHaveAttribute("data-led", NOWHERE);
  await expect.poll(async () => manuscript.scroll()).toEqual(on);
  await expect.poll(async () => manuscript.showing()).toEqual([CHAPTER]);

  // A note no book reads turns the pane nowhere either.
  await manuscript.moveTo(OUTSIDE);
  await manuscript.scrollTo(1);
  await expect.poll(async () => manuscript.showing()).toEqual([OUTSIDE]);
  await expect(book.surface).toHaveAttribute("data-first", "1");
});

test("a cold session says what the book is waiting on rather than showing an empty pane", async ({
  book,
  manuscript,
  vault,
}) => {
  // A book is typeset once a session, so the run puts this one back on
  // the shelf before asking for the state that only a cold one shows. A
  // chapter's words are an edit to the book on the engine, so it is the
  // book note that takes it off the shelf.
  await vault.modify(BOOK, await vault.read(BOOK));

  const said = await book.settings(async () => {
    await manuscript.open(CHAPTER);
    await manuscript.asBook.click();
    await book.painted();
  });

  const last = said.at(-1) ?? "";
  expect(said.length).toBeGreaterThan(0);
  expect(last).toContain("Setting");
  expect(last).toContain("Pride and Prejudice");
  expect(last).toContain(`chapters of ${String(SECTIONS)}`);
  expect(last).toContain("it will open at Chapter Twelve");
});

// What this spec does not cover: a book long enough for the wait to be
// worth watching. The fixture sets in one frame, so the state is caught
// as it is written rather than read off the screen. Nor does it cover a
// pane that turns when it should not have: the assertions that nothing
// moved read the pane after the moves they follow have been answered,
// which catches a turn already made rather than one still coming.
