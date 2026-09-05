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

  // A book with no chapters yet appends to its body, not to whichever
  // of its groups the note happens to write last.
  await navigator.adding("Untitled book.md");
  await obsidian.choose("Add an existing note");
  await navigator.pick("Chapter Twelve");

  await expect
    .poll(async () => vault.read("Untitled book.md"))
    .toContain("# Body\n\n- [[Chapter Twelve]]\n");
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

  await navigator.adding(BOOK);
  await obsidian.choose("Add an existing note");
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
  obsidian,
  vault,
}) => {
  vault.touch(BOOK);
  vault.touch("New chapter.md");
  await navigator.reveal();

  await navigator.adding(BOOK);
  await obsidian.choose("New chapter");

  await expect(navigator.entry(BOOK, "New chapter")).toBeVisible();
  expect(await vault.read("New chapter.md")).toContain("# New chapter");
  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("- [[Chapter Four]]\n- [[New chapter]]\n");
});

test("a drag reorders the list, an entry keeps its role across a section, and the menu sets one", async ({
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

  // A section groups the reading order and says nothing about what is
  // in it, so an entry carries its role across one. A row lands where
  // the gap opened: on the heading below, and so at the end of the
  // section above it.
  await navigator.drag(
    navigator.entry(BOOK, "Acknowledgements"),
    navigator.group(BOOK, "Body"),
    "above",
  );

  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("- `contents`\n- [[Acknowledgements]] `back-matter`\n");
  await expect(navigator.entry(BOOK, "Acknowledgements")).toHaveAttribute(
    "data-role",
    "back-matter",
  );

  // A per-entry override sits in the context menu. An edit names an
  // entry by its place in the reading order, so the wait is on the
  // place the row now carries.
  await expect(navigator.entry(BOOK, "Chapter Twelve")).toHaveAttribute(
    "data-at",
    "7",
  );
  await navigator.menuOn(navigator.entry(BOOK, "Chapter Twelve"));
  await obsidian.choose("Role for this entry");
  await navigator.pick("Epigraph");

  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("- [[Chapter Twelve]] `epigraph`");
});

test("a row dragged past the bottom stays inside its list, and lands last", async ({
  navigator,
  vault,
}) => {
  vault.touch(BOOK);
  await navigator.reveal();
  await expect(navigator.entry(BOOK, "Copyright")).toBeVisible();
  const short = await navigator.reach();

  // A row carried below the list would stretch the shelf under it.
  await navigator.dragOffTheEnd(navigator.entry(BOOK, "Copyright"), async () => {
    expect((await navigator.reach()).height).toBe(short.height);
  });

  // The last row is the css section's heading, so that is where it lands.
  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("# The book's css\n\n- [[Copyright]] `copyright`\n");
  await expect(navigator.entries(BOOK).last()).toHaveText(/Copyright/);

  // A book long enough to scroll the view it is drawn in. The shelf
  // stretched here too, and the view then scrolled after the row for
  // as long as it was held. Where the row lands is left to the drag
  // above: under an auto-scroll it depends on how long the hold ran.
  const drawn = await navigator.painted();
  const long = (await vault.read(BOOK)).replace(
    "# Body\n\n",
    `# Body\n\n${Array.from({ length: 40 }, (_, at) => `- [[Chapter ${at}]]`).join("\n")}\n`,
  );
  await vault.modify(BOOK, long);
  await navigator.repainted(drawn);
  await expect(navigator.entries(BOOK)).toHaveCount(48);
  const tall = await navigator.reach();
  expect(tall.most).toBeGreaterThan(0);

  // The wait is on the view running out of scroll, not on a duration:
  // a shelf that grows under the row never reaches its own end.
  await navigator.dragOffTheEnd(navigator.entry(BOOK, "Chapter 0"), async () => {
    await expect
      .poll(async () => {
        const now = await navigator.reach();
        return { grew: now.height !== tall.height, ended: now.top >= now.most };
      })
      .toEqual({ grew: false, ended: true });
  });

  expect((await navigator.reach()).height).toBe(tall.height);
  await expect.poll(async () => vault.read(BOOK)).toContain("[[Chapter 0]]");
});

test("`Remove from book` takes the entry out and nothing else, and an entry never deletes", async ({
  navigator,
  obsidian,
  vault,
}) => {
  vault.touch(BOOK);
  await navigator.reveal();

  await navigator.menuOn(navigator.entry(BOOK, "Chapter Twelve"));

  await expect(obsidian.item("Delete")).toHaveCount(0);
  await obsidian.choose("Remove from book");

  await expect(navigator.entry(BOOK, "Chapter Twelve")).toHaveCount(0);
  await expect.poll(async () => vault.read(BOOK)).not.toContain("Chapter Twelve");
  // The note the entry borrowed is still in the vault.
  expect(await vault.notes()).toContain("Chapter Twelve.md");
});

test("a book is deleted only after the author says so, and its notes stay", async ({
  navigator,
  note,
  obsidian,
  vault,
}) => {
  await vault.write(SECOND, NOVELS);
  await navigator.reveal();
  await expect(navigator.book(SECOND)).toBeVisible();
  // The book is open in its own view, which is the note's one writer
  // while it is: a trashed note leaves it nothing to write back to.
  await note.open(SECOND);
  await expect(note.page).toBeVisible();

  // The book note is orca's own, so it is the one thing here that
  // deletes. Nothing goes until the question is answered.
  await navigator.menuOn(navigator.name(SECOND));
  await obsidian.choose("Delete book");
  await navigator.answer("Cancel");
  await expect(navigator.book(SECOND)).toBeVisible();

  const said = await obsidian.notices(async () => {
    await navigator.menuOn(navigator.name(SECOND));
    await obsidian.choose("Delete book");
    await navigator.answer("Delete");
    await expect(navigator.book(SECOND)).toHaveCount(0);
  });

  await expect.poll(async () => vault.notes()).not.toContain(SECOND);
  // The notes the book listed are borrowed, and stay in the vault.
  expect(await vault.notes()).toContain("Chapter Twelve.md");
  // The view the note was open in wrote nothing back to a path the
  // vault no longer has.
  expect(said).toEqual([]);
});

test("a book deleted under an unwritten edit has nothing written back to it", async ({
  navigator,
  note,
  obsidian,
  vault,
}) => {
  vault.touch(BOOK);
  await vault.write(SECOND, NOVELS);
  await navigator.reveal();
  await note.open(SECOND);
  await expect(note.page).toBeVisible();

  const said = await obsidian.notices(async () => {
    await note.editAndDelete("The Bennet Novels");

    // The settle that edit armed comes due a second later. The fixture
    // book's own settle is the wait for that second having passed,
    // since it is armed after the delete and lands after its own.
    await note.open(BOOK);
    await note.edit("Settled");
    await expect.poll(async () => vault.read(BOOK)).toContain("title: Settled");
  });

  expect(said).toEqual([]);
  expect(await vault.notes()).not.toContain(SECOND);
  await expect(navigator.book(SECOND)).toHaveCount(0);
});

test("a generated section is added by its role, and reads as one", async ({
  navigator,
  obsidian,
  vault,
}) => {
  vault.touch(BOOK);
  await navigator.reveal();

  await navigator.adding(BOOK);
  await obsidian.choose("New generated section");
  await navigator.pick("Title page");

  // It goes where a chapter would, and carries no link at all.
  await expect
    .poll(async () => vault.read(BOOK))
    .toContain("- [[Chapter Four]]\n- `title-page`\n");
  const made = navigator.entries(BOOK).filter({ hasText: "Title page" });
  await expect(made).toHaveCount(2);
  await expect(made.last()).toHaveAttribute("data-kind", "generated");
});

test("a section is made, renamed, dragged and taken out, and its entries stay", async ({
  navigator,
  obsidian,
  vault,
}) => {
  vault.touch(BOOK);
  await navigator.reveal();
  await expect(navigator.groups(BOOK)).toContainText([
    "Front matter",
    "Body",
    "Back matter",
    "The book's css",
  ]);

  await navigator.adding(BOOK);
  await obsidian.choose("New section");

  await expect.poll(async () => vault.read(BOOK)).toContain("# New section\n");

  // A rename is the heading's own line. The entries under it keep the
  // roles they carry, because the heading never gave them one.
  await navigator.menuOn(navigator.group(BOOK, "Front matter"));
  await obsidian.choose("Rename section");
  await navigator.renaming(BOOK).fill("Prelims");
  // The list answers a wikilink pasted into it. The rename box inside
  // it does not: what is pasted there is the section's name.
  await navigator.pasteFocused("and [[Chapter Ten]]");
  await navigator.renaming(BOOK).press("Enter");

  await expect.poll(async () => vault.read(BOOK)).toContain("# Prelims\n");
  await expect(navigator.group(BOOK, "Prelims")).toBeVisible();
  expect(await vault.read(BOOK)).not.toContain("[[Chapter Ten]]");
  await expect(navigator.entry(BOOK, "Copyright")).toHaveAttribute(
    "data-role",
    "copyright",
  );

  // A whole section drags, and everything under it goes along.
  const drawn = await navigator.painted();
  await navigator.drag(
    navigator.group(BOOK, "Back matter"),
    navigator.group(BOOK, "Prelims"),
    "above",
  );

  // The list shows the drag before the note has it, so the wait is on
  // the note and then on the paint that read it back.
  await expect
    .poll(async () => vault.read(BOOK))
    .toMatch(/# Back matter\n\n- \[\[Acknowledgements\]\] `back-matter`\n\n# Prelims\n/);
  await navigator.repainted(drawn);
  await expect(navigator.groups(BOOK)).toContainText([
    "Back matter",
    "Prelims",
    "Body",
    "The book's css",
    "New section",
  ]);

  // The last place is a place. A section dropped past every other one
  // lands after it rather than short of it.
  const again = await navigator.painted();
  await navigator.drag(
    navigator.group(BOOK, "Back matter"),
    navigator.group(BOOK, "New section"),
    "below",
  );

  await expect
    .poll(async () => vault.read(BOOK))
    .toMatch(/# New section\n[\s\S]*# Back matter\n\n- \[\[Acknowledgements\]\]/);
  await navigator.repainted(again);
  await expect(navigator.groups(BOOK)).toContainText([
    "Prelims",
    "Body",
    "The book's css",
    "New section",
    "Back matter",
  ]);

  // Taking a section out takes its heading and nothing else.
  await navigator.menuOn(navigator.group(BOOK, "New section"));
  await obsidian.choose("Remove section");
  await expect.poll(async () => vault.read(BOOK)).not.toContain("# New section");
  await expect(navigator.entry(BOOK, "Acknowledgements")).toBeVisible();
});

test("a book note opens as a book, and the editor is never mounted on the way", async ({
  navigator,
  obsidian,
  vault,
}) => {
  vault.touch(BOOK);
  await navigator.reveal();

  // Every route in reaches a leaf through `setViewState`, so a book
  // note put on the editor is on the book view by the time it draws.
  const shown = await obsidian.page.evaluate(async (at) => {
    const leaf = window.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: "markdown", state: { file: at } });
    return leaf.view.getViewType();
  }, BOOK);

  expect(shown).toEqual("orca-book");
  await expect(obsidian.view("orca-book")).toBeVisible();
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
