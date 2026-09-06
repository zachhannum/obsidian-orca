import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The one chapter the fixture has a note for, and its words. */
const CHAPTER = "Chapter Twelve";
const CHAPTER_WORDS = 186;

/** The words in every note the fixture book reads. */
const BOOK_WORDS = 248;

test("a metadata edit on the page is written to the note once, on settle", async ({
  note,
  vault,
}) => {
  await note.open(BOOK);
  await expect(note.metadata("publisher")).toHaveValue("Whitehall Press");

  const writes = await vault.writes(BOOK, async () => {
    // One keystroke is one edit and one paint, and the settle waits for
    // the last of them.
    await note.metadata("publisher").click();
    await note.metadata("publisher").press("End");
    await note.metadata("publisher").pressSequentially(", London");
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
