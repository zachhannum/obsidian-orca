import { expect, test } from "./harness/test";

/** The chapter the fixture has a note for. */
const CHAPTER = "Chapter Twelve.md";

/** The words typed into it, as one burst. */
const TYPED = "Kitty had a cough.";

test("a burst of keystrokes is one render, and the pages last painted stay until it lands", async ({
  book,
  manuscript,
  vault,
}) => {
  vault.touch(CHAPTER);
  await manuscript.open(CHAPTER);
  await book.split();
  const painted = await book.painted();
  const opens = await book.reading();
  await manuscript.place({ line: 2, ch: 0 });

  const said = await book.settings(async () => {
    await manuscript.type(TYPED);
    await expect
      .poll(async () => book.painted())
      .toBeGreaterThan(painted);
  });

  // Eighteen keystrokes, one render: the generation the pane painted
  // rose once, not once per key.
  expect(await book.painted()).toEqual(painted + 1);
  // The book was never set again from nothing, so the pages the reader
  // had were on screen the whole time the render ran.
  expect(said).toEqual([]);
  await expect(book.sheets).toHaveCount(1);
  // The page redraws where the writer was, carrying what they wrote.
  await expect(book.surface).toHaveAttribute("data-first", String(opens));
  await expect(book.page).toContainText(TYPED);
});

test("the note written after the keystrokes that made it renders nothing a second time", async ({
  book,
  manuscript,
  vault,
}) => {
  vault.touch(CHAPTER);
  await manuscript.open(CHAPTER);
  await book.split();
  const painted = await book.painted();
  await manuscript.place({ line: 2, ch: 0 });

  await manuscript.type(TYPED);
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  // Obsidian writes the note some time after the typing stops, and what
  // lands on disk is the text the engine was already sent.
  await expect.poll(async () => vault.read(CHAPTER)).toContain(TYPED);

  expect(await book.painted()).toEqual(painted + 1);
});
