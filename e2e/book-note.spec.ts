import { expect, test } from "./harness/test";

/** The book note in the fixture vault, and one a newer orca wrote. */
const BOOK = "Pride and Prejudice.md";
const NEWER = "The Voyage to Lilliput.md";

test("a note with the key opens in orca's view, and `Open as markdown` returns it", async ({
  note,
  vault,
}) => {
  const before = await vault.read(BOOK);

  await note.open(BOOK);

  await expect(note.page).toContainText("Pride and Prejudice");
  await expect(note.page).toContainText("orca-book: 1");
  // What the engine does not carry is on the page orca draws.
  await expect(note.metadata("publisher")).toContainText("Whitehall Press");
  await expect(note.metadata("series")).toContainText("The Bennet Novels");
  await expect(note.metadata("isbn")).toContainText("978-0-000-00000-0");

  await note.asMarkdown();

  await expect(note.markdown).toBeVisible();
  await expect(note.markdown).toContainText("Chapter Twelve");
  await expect(note.page).toHaveCount(0);
  // Opening a book writes nothing: the note is as it was checked in.
  expect(await vault.read(BOOK)).toEqual(before);
});

test("a book from a newer orca does not open, names both formats, and offers `Open as markdown`", async ({
  note,
  vault,
}) => {
  await vault.write(
    NEWER,
    "---\norca-book: 2\ntitle: The Voyage to Lilliput\n---\n\n# Body\n\n- [[Chapter Twelve]]\n",
  );

  await note.open(NEWER);

  await expect(note.refused).toContainText("format 1");
  await expect(note.refused).toContainText("format 2");
  // The book itself did not open.
  await expect(note.metadata("title")).toHaveCount(0);

  await note.refused.getByRole("button", { name: "Open as markdown" }).click();

  await expect(note.markdown).toBeVisible();
  await expect(note.markdown).toContainText("Chapter Twelve");
});
