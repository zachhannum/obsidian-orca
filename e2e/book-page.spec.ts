import { expect, test } from "./harness/test";
import { NAVIGATOR } from "./harness/navigator";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The one chapter the fixture has a note for, and its words. */
const CHAPTER = "Chapter Twelve";
const CHAPTER_WORDS = 674;

/** The words in every note the fixture book reads. */
const BOOK_WORDS = 736;

test("a metadata edit on the page is written to the note once, on settle", async ({
  note,
  vault,
}) => {
  await note.open(BOOK);
  await expect(note.metadata("publisher")).toHaveValue("Whitehall Press");

  const writes = await vault.writes(BOOK, async () => {
    // Two fields, two edits and two paints, and the settle waits for
    // the last of them, however far apart the two land.
    await note.metadata("publisher").fill("Whitehall Press, London");
    await note.metadata("series").fill("");

    await expect(note.metadata("publisher")).toHaveValue(
      "Whitehall Press, London",
    );
    await expect.poll(async () => vault.read(BOOK)).toContain(
      "publisher: Whitehall Press, London",
    );
  });

  expect(writes).toEqual(1);
  const after = await vault.read(BOOK);
  // An emptied property comes off the note, and the author's own
  // properties are left alone.
  expect(after).not.toContain("series:");
  expect(after).toContain("- novel");
  expect(after).toContain("status: drafting");
  // The emptied field shows its placeholder.
  await expect(note.metadata("series")).toHaveValue("");
  await expect(note.metadata("series")).toHaveAttribute(
    "placeholder",
    "[YOUR SERIES]",
  );
});

test("the reading order is read-only on the page, and clicking an entry focuses it in the navigator", async ({
  navigator,
  note,
  obsidian,
  vault,
}) => {
  await note.open(BOOK);
  await expect(note.entry(CHAPTER)).toBeVisible();
  const before = await vault.read(BOOK);

  // Nothing on the page can move a row: there is no sortable, and every
  // entry is a button.
  await expect(note.order.locator("[aria-roledescription]")).toHaveCount(0);
  await expect(note.order.getByRole("button")).toHaveCount(8);
  await expect(note.entry("Title page")).toContainText("generated");
  await expect(note.entry("Volume the First")).toContainText("part");

  // The sidebar is closed, so the navigator has to be revealed before
  // the entry can be focused there.
  await obsidian.collapse();
  expect(await obsidian.collapsed()).toEqual(true);

  await note.entry(CHAPTER).click();

  await expect.poll(async () => obsidian.collapsed()).toEqual(false);
  await expect(navigator.entry(BOOK, CHAPTER)).toBeFocused();
  // The click edited nothing.
  expect(await vault.read(BOOK)).toEqual(before);
});

test("a locate that creates the navigator still focuses the entry, however the leaf came up", async ({
  navigator,
  note,
  obsidian,
}) => {
  // The navigator leaf is gone, so the click below has to make one
  // from nothing rather than reveal one already holding the book.
  await obsidian.detach(NAVIGATOR);
  await note.open(BOOK);

  await note.entry(CHAPTER).click();

  await expect(navigator.entry(BOOK, CHAPTER)).toBeFocused();
});

test("word counts come from the notes, and follow a note as it is written", async ({
  note,
  vault,
}) => {
  await note.open(BOOK);

  await expect(note.words(CHAPTER)).toHaveText(
    String(CHAPTER_WORDS),
  );
  await expect(note.words("Copyright")).toHaveText("16");
  // A generated section and a missing note have no words to count.
  await expect(note.words("Title page")).toHaveText("—");
  await expect(note.words("Chapter Four")).toHaveText("—");
  await expect(note.line).toContainText("2 chapters");
  await expect(note.line).toContainText(`${BOOK_WORDS} words`);

  const chapter = await vault.read(`${CHAPTER}.md`);
  await vault.modify(`${CHAPTER}.md`, `${chapter}\nAnd so the evening passed.\n`);

  await expect(note.words(CHAPTER)).toHaveText(String(CHAPTER_WORDS + 5));
  await expect(note.line).toContainText(`${BOOK_WORDS + 5} words`);
});

/** A folio, or a span of them. */
const FOLIO = /^\d+(–\d+)?$/;

test("folio ranges come from a run of the book through the engine", async ({
  note,
}) => {
  await note.open(BOOK);

  await expect(note.pages("Title page")).toHaveText(FOLIO);
  await expect(note.pages("Copyright")).toHaveText(FOLIO);
  await expect(note.pages(CHAPTER)).toHaveText(FOLIO);
  // A note the vault has none for never lands on a page.
  await expect(note.pages("Chapter Four")).toHaveText("—");
});

test("a folio range follows a note as it grows past its page", async ({
  note,
  vault,
}) => {
  await note.open(BOOK);
  await expect(note.pages(CHAPTER)).toHaveText(FOLIO);
  const before = await note.pages(CHAPTER).textContent();

  const chapter = await vault.read(`${CHAPTER}.md`);
  const grown = `${chapter}\n\n${"And so the evening passed. ".repeat(600)}\n`;
  await vault.modify(`${CHAPTER}.md`, grown);

  // The chapter now spans more pages than it opened on. The range it
  // opened on already reads as a span, so the wait is on the range
  // moving rather than on a dash appearing in it.
  await expect(note.pages(CHAPTER)).not.toHaveText(before ?? "");
  await expect(note.pages(CHAPTER)).toHaveText(FOLIO);
});
