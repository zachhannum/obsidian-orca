import { expect, test } from "./harness/test";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

const RENAMED = "title: First Impressions";

test("an edit is written through the frontmatter API, and the author's own properties survive it", async ({
  note,
  vault,
}) => {
  const before = await vault.read(BOOK);
  vault.touch(BOOK);
  await note.open(BOOK);

  await note.edit("First Impressions");

  await expect.poll(async () => vault.read(BOOK)).toContain(RENAMED);
  const after = await vault.read(BOOK);
  expect(after).toContain("orca-book: 1");
  // The properties orca does not own are the author's, and Obsidian's
  // own API is what leaves them alone.
  expect(after).toContain("- novel");
  expect(after).toContain("status: drafting");
  // The edit touched no property in the body, so the body is as it was
  // checked in, css block and all.
  const body = (text: string): string => text.slice(text.lastIndexOf("\n---\n"));
  expect(body(after)).toEqual(body(before));
});

test("a change on disk reloads a clean view and asks one with an unwritten edit", async ({
  note,
  vault,
}) => {
  const before = await vault.read(BOOK);
  const outside = (title: string): string =>
    before.replace("title: Pride and Prejudice", `title: ${title}`);
  await note.open(BOOK);
  await expect(note.page).toContainText("Pride and Prejudice");

  // There is no unwritten edit, so the note goes straight onto the
  // page.
  await vault.modify(BOOK, outside("First Impressions"));

  await expect(note.page).toContainText("First Impressions");
  await expect(note.changed).toHaveCount(0);

  // There is an unwritten edit, so the author settles the two versions.
  await note.edit("Dragged");
  await vault.modify(BOOK, outside("Written outside"));

  await expect(note.changed).toBeVisible();
  await note.changed
    .getByRole("button", { name: "Take what is on disk" })
    .click();

  await expect(note.page).toContainText("Written outside");
  expect(await vault.read(BOOK)).toContain("title: Written outside");
});

test("a dragged control repaints per frame and writes the note once, on settle", async ({
  note,
  vault,
}) => {
  await note.open(BOOK);
  const painted = await note.painted();

  const writes = await vault.writes(BOOK, async () => {
    await note.drag("Frame", 40);

    // Every frame is on the page, and the note has one of them.
    await expect(note.page).toHaveAttribute(
      "data-generation",
      String(painted + 40),
    );
    await expect(note.page).toContainText("Frame 39");
    await expect.poll(async () => vault.read(BOOK)).toContain("title: Frame 39");
  });

  expect(writes).toEqual(1);
});
