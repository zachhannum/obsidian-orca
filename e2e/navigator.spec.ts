import { expect, test } from "./harness/test";

/** The book note in the fixture vault, and the notes a spec makes. */
const BOOK = "Pride and Prejudice.md";
const SECOND = "The Bennet Novels.md";
const FOLDER = "Manuscript";

/** A second book over one of the fixture's chapters. */
const NOVELS = "---\norca-book: 1\n---\n\n# Body\n\n- [[Chapter Twelve]]\n";

test("a folder of notes becomes a book in sorted order, and `New book` makes an empty one", async ({
  navigator,
  obsidian,
  vault,
}) => {
  await vault.folder(FOLDER);
  for (const name of ["Chapter Two", "Chapter Ten", "Chapter One"]) {
    await vault.write(`${FOLDER}/${name}.md`, `# ${name}\n`);
  }
  vault.touch(`${FOLDER}.md`);
  vault.touch("Untitled book.md");
  await navigator.reveal();

  expect(await obsidian.fileMenu(FOLDER)).toContain(
    "Create book from these notes",
  );
  await obsidian.fileMenu(FOLDER, "Create book from these notes");

  // Alphabetical order is trusted here and nowhere else.
  await expect
    .poll(async () => vault.read(`${FOLDER}.md`))
    .toContain("- [[Chapter One]]\n- [[Chapter Ten]]\n- [[Chapter Two]]");
  await expect(navigator.book(`${FOLDER}.md`)).toContainText("Chapter One");

  await obsidian.command("orca:new-book");

  await expect
    .poll(async () => vault.read("Untitled book.md"))
    .toContain("orca-book: 1");
  await expect(navigator.book("Untitled book.md")).toContainText("Body");
});

test("the quick pick, `Add to book` and a pasted wikilink write the same line", async ({
  navigator,
  obsidian,
  vault,
}) => {
  vault.touch(BOOK);
  for (const name of ["Route One", "Route Two", "Route Three"]) {
    await vault.write(`${name}.md`, `# ${name}\n`);
  }
  await navigator.reveal();
  await expect(navigator.book(BOOK)).toBeVisible();

  await navigator.button("Add a note to a book").click();
  await navigator.pick("Route One");
  await expect(navigator.entry(BOOK, "Route One")).toBeVisible();

  await obsidian.fileMenu("Route Two.md", "Add to book");
  await expect(navigator.entry(BOOK, "Route Two")).toBeVisible();

  await navigator.paste(BOOK, "as we said in [[Route Three]] last week");
  await expect(navigator.entry(BOOK, "Route Three")).toBeVisible();

  // Three routes, one line each, at the end of the body.
  await expect
    .poll(async () => vault.read(BOOK))
    .toContain(
      "- [[Chapter Four]]\n- [[Route One]]\n- [[Route Two]]\n- [[Route Three]]\n",
    );
});

test("`New chapter` makes a note in the book's folder and appends it in one step", async ({
  navigator,
  vault,
}) => {
  vault.touch(BOOK);
  vault.touch("New chapter.md");
  await navigator.reveal();

  await navigator.newChapter(BOOK).click();

  await expect(navigator.entry(BOOK, "New chapter")).toBeVisible();
  expect(await vault.read("New chapter.md")).toContain("# New chapter");
  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("- [[Chapter Four]]\n- [[New chapter]]\n");
});

test("a drag reorders the list, a drag across a heading re-roles the entry, and the menu overrides one role", async ({
  navigator,
  obsidian,
  vault,
}) => {
  vault.touch(BOOK);
  await navigator.reveal();
  // The list the drag starts from, which is also what the spec before
  // this one put back.
  await expect(navigator.entries(BOOK)).toContainText([
    "Title page",
    "Copyright",
    "A note on the text",
    "Contents",
    "Volume the First",
    "Chapter Twelve",
    "Chapter Four",
    "Acknowledgements",
  ]);

  await navigator.drag(
    navigator.entry(BOOK, "Chapter Four"),
    navigator.entry(BOOK, "Volume the First"),
    "above",
  );

  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("- [[Chapter Four]]\n- [[Volume the First]] `part`\n");

  // The heading an entry lands under is its role, and the tag that
  // overrode the old one goes with it.
  await navigator.drag(
    navigator.entry(BOOK, "Acknowledgements"),
    navigator.group(BOOK, "Front matter"),
    "below",
  );

  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("# Front matter\n\n- [[Acknowledgements]]\n");
  await expect(navigator.entry(BOOK, "Acknowledgements")).toHaveAttribute(
    "data-role",
    "front-matter",
  );

  // A per-entry override sits in the context menu.
  await navigator.entry(BOOK, "Chapter Twelve").click({ button: "right" });
  await obsidian.item("Role for this entry").click();
  await navigator.pick("Epigraph");

  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("- [[Chapter Twelve]] `epigraph`");
});

test("`Remove from book` takes the entry out and nothing else, and no menu here deletes", async ({
  navigator,
  obsidian,
  vault,
}) => {
  vault.touch(BOOK);
  await navigator.reveal();

  await navigator.entry(BOOK, "Chapter Twelve").click({ button: "right" });

  await expect(obsidian.menu()).toBeVisible();
  await expect(obsidian.item("Delete")).toHaveCount(0);
  await obsidian.item("Remove from book").click();

  await expect(navigator.entry(BOOK, "Chapter Twelve")).toHaveCount(0);
  await expect.poll(async () => vault.read(BOOK)).not.toContain("Chapter Twelve");
  // The note the entry borrowed is still in the vault.
  expect(await vault.notes()).toContain("Chapter Twelve.md");
});

test("a quiet line reports the notes in the book's folder that are not in it", async ({
  navigator,
  vault,
}) => {
  vault.touch(BOOK);
  await navigator.reveal();
  await expect(navigator.loose(BOOK)).toHaveCount(0);

  await vault.write("Chapter Four (rewrite).md", "# Chapter Four\n");

  await expect(navigator.loose(BOOK)).toContainText(
    "1 note in this book's folder isn't in the reading order",
  );
  await navigator.loose(BOOK).getByRole("button", { name: "Add" }).click();

  await expect(navigator.entry(BOOK, "Chapter Four (rewrite)")).toBeVisible();
  await expect(navigator.loose(BOOK)).toHaveCount(0);
});

test("the navigator highlights the book the active note is in, and both books when it is in two", async ({
  navigator,
  note,
  vault,
}) => {
  await vault.write(SECOND, NOVELS);
  await navigator.reveal();
  await expect(navigator.book(SECOND)).toBeVisible();

  await note.open("Acknowledgements.md");

  await expect(navigator.book(BOOK)).toHaveAttribute("data-holds", "true");
  await expect(navigator.book(SECOND)).toHaveAttribute("data-holds", "false");

  // The same note sits in two books, and both are highlighted.
  await note.open("Chapter Twelve.md");

  await expect(navigator.book(BOOK)).toHaveAttribute("data-holds", "true");
  await expect(navigator.book(SECOND)).toHaveAttribute("data-holds", "true");
});

test("opening a book note reveals the navigator", async ({
  navigator,
  note,
  obsidian,
}) => {
  await obsidian.collapse();
  expect(await obsidian.collapsed()).toEqual(true);

  await note.open(BOOK);

  await expect.poll(async () => obsidian.collapsed()).toEqual(false);
  await expect(navigator.pane).toBeVisible();
  await expect(navigator.book(BOOK)).toContainText("Pride and Prejudice");
});

test("a missing note keeps its entry, which renders in place with `Locate` and `Remove`", async ({
  navigator,
  vault,
}) => {
  vault.touch(BOOK);
  await vault.write("Chapter Four (rewrite).md", "# Chapter Four\n");
  await navigator.reveal();

  const missing = navigator.entry(BOOK, "Chapter Four");
  await expect(missing).toHaveAttribute("data-kind", "missing");
  await expect(missing.getByRole("button", { name: "Remove" })).toBeVisible();

  await missing.getByRole("button", { name: "Locate" }).click();
  await navigator.pick("Chapter Four (rewrite)");

  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("- [[Chapter Four (rewrite)]]");
  await expect(navigator.entry(BOOK, "Chapter Four (rewrite)")).toHaveAttribute(
    "data-kind",
    "note",
  );
});
