import { expect, test } from "./harness/test";

/** The book note in the fixture vault, and one a newer orca wrote. */
const BOOK = "Pride and Prejudice.md";
const NEWER = "The Voyage to Lilliput.md";

/** Another, opened in a leaf the first spec has not handed to the editor. */
const AHEAD = "The Voyage to Brobdingnag.md";

/** A book note from a newer orca than this build. */
const newer = (title: string): string =>
  `---\norca-book: 2\ntitle: ${title}\n---\n\n# Body\n\n- [[Chapter Twelve]]\n`;

test("a note with the key opens in orca's view, and `Open as markdown` returns it", async ({
  note,
  vault,
}) => {
  const before = await vault.read(BOOK);

  await note.open(BOOK);

  await expect(note.page).toContainText("Pride and Prejudice");
  await expect(note.page).toContainText("orca-book: 1");
  // What the engine does not have is on the page orca draws.
  await expect(note.metadata("publisher")).toHaveValue("Whitehall Press");
  await expect(note.metadata("series")).toHaveValue("The Bennet Novels");
  await expect(note.metadata("isbn")).toHaveValue("978-0-000-00000-0");

  await note.asMarkdown();

  await expect(note.markdown).toBeVisible();
  await expect(note.markdown).toContainText("Chapter Twelve");
  await expect(note.page).toHaveCount(0);
  // Opening a book writes nothing: the note is as it was checked in.
  expect(await vault.read(BOOK)).toEqual(before);

  await note.asBook();

  await expect(note.page).toContainText("Pride and Prejudice");
});

test("a book from a newer orca does not open, names both formats, and offers `Open as markdown`", async ({
  note,
  vault,
}) => {
  await vault.write(NEWER, newer("The Voyage to Lilliput"));

  await note.open(NEWER);

  await expect(note.refused).toContainText("format 1");
  await expect(note.refused).toContainText("format 2");
  // The book itself did not open.
  await expect(note.metadata("title")).toHaveCount(0);

  await note.refused.getByRole("button", { name: "Open as markdown" }).click();

  await expect(note.markdown).toBeVisible();
  await expect(note.markdown).toContainText("Chapter Twelve");
});

test("an edit aimed at a book its view cannot write is refused out loud", async ({
  navigator,
  note,
  obsidian,
  vault,
}) => {
  await vault.write(AHEAD, newer("The Voyage to Brobdingnag"));

  await note.open(AHEAD);
  await expect(note.refused).toBeVisible();

  // A view is the note's one writer while it is open, and a refused
  // book has none at all. The edit goes to the note rather than to a
  // view that would drop it, and the note refuses it in turn.
  const said = await obsidian.notices(async () => {
    await obsidian.fileMenu("Acknowledgements.md", "Add to book");
    await navigator.pick("Brobdingnag");
    await expect(obsidian.notice()).toContainText("the book was not edited");
  });

  expect(said.join(" ")).toContain("the book was not edited");
  expect(await vault.read(AHEAD)).toEqual(newer("The Voyage to Brobdingnag"));
});
