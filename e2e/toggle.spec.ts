import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The chapter the fixture has a note for, and the last note the book reads. */
const CHAPTER = "Chapter Twelve.md";
const LAST = "Acknowledgements.md";

/** A note no book in the fixture reads. */
const OUTSIDE = "Loose.md";

/** The sections the fixture book is set from: eight entries, one with no note. */
const SECTIONS = 7;

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

  // A chapter laid out by itself is a different chapter, so the page
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

test("and the book follows the manuscript, to the page each chapter opens on", async ({
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
  await expect(book.surface).toHaveAttribute("data-note", CHAPTER);
  // The page the chapter opens on, rather than whichever of its pages
  // the book happened to be turned to.
  await expect(book.surface).toHaveAttribute("data-first", String(opens));
});

test("the link is chapter-granular, which is all a page-through can be", async ({
  book,
  manuscript,
  vault,
}) => {
  const chapter = await vault.read(CHAPTER);
  await vault.modify(
    CHAPTER,
    `${chapter}\n\n${"And so the evening passed. ".repeat(600)}\n`,
  );

  await manuscript.open(CHAPTER);
  await book.split();
  await book.painted();
  const opens = await book.reading();

  // The chapter now runs over several pages, and turning through them
  // leaves the manuscript where it is. A note is the smallest thing a
  // page can be traced back to.
  await book.next.click();
  await expect(book.surface).toHaveAttribute("data-first", String(opens + 1));
  await expect(book.surface).toHaveAttribute("data-note", CHAPTER);
  await expect.poll(async () => manuscript.showing()).toEqual([CHAPTER]);
});

test("a cold session says what the book is waiting on rather than showing an empty pane", async ({
  book,
  manuscript,
  vault,
}) => {
  // A book is laid out once a session, so the run puts this one back on
  // the shelf before asking for the state that only a cold one shows.
  await vault.modify(CHAPTER, await vault.read(CHAPTER));

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
// as it is written rather than read off the screen.
