/**
 * A worker can die on its own, and everything the book was made of is
 * on the main thread. The spec kills the worker under a render and
 * waits for the pages to come back.
 *
 * A new engine counts its own generations, so a surface back at
 * generation 1 after an edit is a book set again rather than a book
 * repainted.
 */

import { expect, test } from "./harness/test";
import type { Vault } from "./harness/vault";

/** The book note in the fixture vault, and the chapter it reads. */
const BOOK = "Pride and Prejudice.md";
const CHAPTER = "Chapter Twelve.md";

/** The chapter as the toolbar names it. */
const CHAPTER_NAME = "Chapter Twelve";

/** The words the edit puts in the chapter, which no fixture page has. */
const TYPED = "The engine died halfway through this sentence.";

/**
 * The chapter with the typed line under the paragraph it opens on, so
 * the page the chapter opens on carries the line. The line goes second
 * because a drop cap takes the first letter of the opening
 * paragraph.
 */
function typed(chapter: string): string {
  const parts = chapter.split("\n\n");
  return [...parts.slice(0, 3), TYPED, ...parts.slice(3)].join("\n\n");
}

/**
 * Puts the book back on the shelf. A book is typeset once a session
 * and it is the book note that takes it off, so this is what makes a
 * pane open on a book orca has not set yet, with no death behind it.
 */
async function shelved(vault: Vault): Promise<void> {
  await vault.modify(BOOK, await vault.read(BOOK));
}

test("a worker killed under a render is set again, and the pages come back", async ({
  book,
  vault,
}) => {
  await shelved(vault);
  await book.open();
  await book.painted();

  // An edit has crossed, so the engine that dies is a generation past
  // the one the book opened on.
  await vault.modify(CHAPTER, typed(await vault.read(CHAPTER)));
  await expect.poll(async () => book.painted()).toBeGreaterThan(1);

  const noticed = await book.noticed(async () => {
    await book.kill(BOOK);
    await expect(book.surface).toHaveAttribute("data-generation", "1");
  });

  // The pane said what it was doing, and the pages it last painted
  // were under every word of it.
  expect(noticed.length).toBeGreaterThan(0);
  for (const notice of noticed) {
    expect(notice.again, notice.said).toBe(true);
    expect(notice.pages, notice.said).toBeGreaterThan(0);
    expect(notice.said).toContain("nothing you wrote was lost");
  }

  // The book on the new engine is the book orca had, the edit
  // included, rather than the book it opened with.
  await book.choose(CHAPTER_NAME);
  await expect(book.page).toContainText(TYPED);
});

test("the second death holds the pages and offers the report", async ({
  book,
  vault,
}) => {
  await shelved(vault);
  await book.open();
  await book.painted();

  const first = await book.kill(BOOK);
  await book.restarted(BOOK, first);

  await book.kill(BOOK);
  await expect(book.held).toBeVisible();
  await expect(book.held).toContainText(
    "the pages here are the ones from before",
  );
  await expect(book.report).toBeVisible();

  // The pages the engine that died set are the ones on screen, and
  // orca started no third worker to set them again.
  await expect(book.sheets.first()).toBeVisible();
  await expect.poll(async () => book.engines(BOOK)).toBe(0);
});
