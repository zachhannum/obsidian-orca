import { expect, test } from "./harness/test";
import type { Vault } from "./harness/vault";

/** The fixture chapter written in every form an attribute run takes. */
const CHAPTER = "Chapter Fifteen.md";

/** The book note that lists the chapter. */
const BOOK = "Pride and Prejudice.md";

/** A note the fixture book does not list. */
const OUTSIDE = "A note on the text.md";

/** The line the chapter's attribute line is written on, counting from 0. */
const ATTRIBUTE_LINE = 5;

/** The column the id on that line ends at. */
const ID_END = 26;

/** A line of prose, where the caret hides no chip. */
const PROSE_LINE = 8;

/** Every chip the chapter carries, in the order the note writes them. */
const CHIPS = [
  "#fifteen .chapter-opening",
  "#entail .plain",
  ".character",
  ".epigraph",
  ".plate",
];

/** The first chip once the id on the opening run is typed out to `#fifteenth`. */
const RENAMED = "#fifteenth .chapter-opening";

/**
 * Every setext line the editor draws, as `level:text`, with each
 * underline as `under:text`. One line over `=` is a heading of level 1,
 * and two lines over `-` are one heading of level 2. The underline is
 * still a line to type on, so the editor keeps it.
 */
const SETEXT = [
  "1:The Parsonage",
  "under:=============",
  "2:A Morning Call",
  "2:Longbourn, in the Spring",
  "under:------------------------",
];

/** The same headings as the reader has them, with no underline to keep. */
const HEADINGS = ["h1:The Parsonage", "h2:A Morning CallLongbourn, in the Spring"];

/**
 * Puts the book back on the shelf, so nothing holds it set and the
 * chapter itself is what opens it.
 */
async function shelved(vault: Vault): Promise<void> {
  await vault.modify(BOOK, await vault.read(BOOK));
}

test("Live Preview draws a chip over every run, and the run's own text comes off", async ({
  book,
  manuscript,
}) => {
  await book.open();
  await manuscript.open(CHAPTER);
  await manuscript.read("source");

  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);

  // The heading's text ends before its run, the span keeps its words
  // and loses its brackets, and no text follows the image.
  await expect(manuscript.pane).toContainText("The Entail");
  await expect(manuscript.pane).not.toContainText("{.plain #entail}");
  await expect(manuscript.pane).not.toContainText("{.plate}");
  // The span keeps its words and loses the brackets around them.
  await expect(manuscript.pane).not.toContainText("[Elizabeth]");
  await expect(manuscript.pane).not.toContainText("{.character}");
});

test("the cursor shows the line it is on, and the rest of the note keeps its chips", async ({
  book,
  manuscript,
}) => {
  await book.open();
  await manuscript.open(CHAPTER);
  await manuscript.read("source");
  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);

  await manuscript.place({ line: ATTRIBUTE_LINE, ch: 0 });

  await expect(manuscript.pane).toContainText("{.chapter-opening #fifteen}");
  await expect
    .poll(async () => manuscript.chipsThrough())
    .toEqual(CHIPS.filter((chip) => chip !== "#fifteen .chapter-opening"));
});

test("Live Preview draws a setext heading at the level of its underline", async ({
  book,
  manuscript,
}) => {
  await book.open();
  await manuscript.open(CHAPTER);
  await manuscript.read("source");
  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);

  await expect.poll(async () => manuscript.setextThrough()).toEqual(SETEXT);
});

test("reading view draws the same chips, and the setext heading with no underline", async ({
  book,
  manuscript,
}) => {
  await book.open();
  await manuscript.open(CHAPTER);

  await manuscript.read("preview");

  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);
  await expect.poll(async () => manuscript.headings()).toEqual(HEADINGS);
  // The pane holds the markup of both views, so the underline the
  // editor keeps is read for in the reader's own box.
  await expect(manuscript.reader).not.toContainText("=============");
  await expect(manuscript.reader).not.toContainText("{.plain #entail}");
  // The lines above a setext underline are drawn in the heading, and
  // the paragraph Obsidian drew them as goes.
  await expect(
    manuscript.reader.locator("p", { hasText: "Longbourn, in the Spring" }),
  ).toHaveCount(0);
});

test("a note no book lists is drawn as Obsidian draws it", async ({
  book,
  manuscript,
  vault,
}) => {
  await book.open();
  await vault.write(OUTSIDE, "{.epigraph}\n\nA paragraph.\n\nOne\n===\n");
  await manuscript.open(OUTSIDE);
  await manuscript.read("source");

  await expect(manuscript.pane).toContainText("{.epigraph}");
  await expect(manuscript.runs).toHaveCount(0);
});

test("a run the engine does not read stays the prose the author typed", async ({
  book,
  manuscript,
  vault,
}) => {
  await book.open();
  // An element answers to one name, so a second id is no run at all.
  await vault.modify(CHAPTER, "{#one #two}\n\nA paragraph.\n");
  await manuscript.open(CHAPTER);
  await manuscript.read("source");

  await expect(manuscript.pane).toContainText("{#one #two}");
  await expect(manuscript.runs).toHaveCount(0);
});

test("a chip stays on its run while the author types, before the next parse", async ({
  book,
  manuscript,
  vault,
}) => {
  await book.open();
  vault.touch(CHAPTER);
  await manuscript.open(CHAPTER);
  await manuscript.read("source");
  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);

  // The typing is ahead of the engine, and the chips already on the
  // text move with it rather than flickering off.
  await manuscript.place({ line: 8, ch: 0 });
  await manuscript.type("A new opening sentence. ");

  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);
});

test("a chapter drawn with no preview open takes its chips", async ({
  book,
  manuscript,
  vault,
}) => {
  await shelved(vault);
  await manuscript.open(CHAPTER);
  await manuscript.read("source");

  // Nothing but the chapter has the book set, so the marks are the
  // chapter's own doing rather than a report on a render elsewhere.
  await expect(book.panes).toHaveCount(0);
  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);
  await expect.poll(async () => manuscript.setextThrough()).toEqual(SETEXT);

  await manuscript.read("preview");

  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);
  await expect.poll(async () => manuscript.headings()).toEqual(HEADINGS);
  await expect(book.panes).toHaveCount(0);
});

test("an edited id redraws the chips with no preview open", async ({
  book,
  manuscript,
  vault,
}) => {
  await shelved(vault);
  vault.touch(CHAPTER);
  await manuscript.open(CHAPTER);
  await manuscript.read("source");
  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);

  await manuscript.place({ line: ATTRIBUTE_LINE, ch: ID_END });
  await manuscript.type("th");
  // The caret leaves the run it edited, which is what puts a chip back
  // over that line.
  await manuscript.place({ line: PROSE_LINE, ch: 0 });

  await expect
    .poll(async () => manuscript.chipsThrough())
    .toEqual([RENAMED, ...CHIPS.slice(1)]);
  await expect(book.panes).toHaveCount(0);

  // The id is typed back, which redraws the chip the other way and
  // hands the next spec the chapter as it is checked in.
  await manuscript.place({ line: ATTRIBUTE_LINE, ch: ID_END + 2 });
  await manuscript.press("Backspace");
  await manuscript.press("Backspace");
  await manuscript.place({ line: PROSE_LINE, ch: 0 });

  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);
});

test("the preview opened after the chapter reads the chapter's own session", async ({
  book,
  manuscript,
  vault,
}) => {
  await shelved(vault);
  await manuscript.open(CHAPTER);
  await manuscript.read("source");
  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);
  await expect.poll(async () => book.engines(BOOK)).toBe(1);

  await book.open();
  await book.settled(BOOK);

  // The preview took the session the chapter had opened, so orca
  // started no second worker on the book.
  expect(await book.engines(BOOK)).toBe(1);
});

test("a manuscript holds the book it draws, and the close hands it to the grace", async ({
  book,
  manuscript,
  note,
  vault,
}) => {
  // This spec begins from a workspace where nothing else holds the
  // book, because a preview or a book page left open anywhere holds
  // its engine too. The fixtures put the panes back when it ends.
  await book.close();
  await note.close();
  await shelved(vault);
  await manuscript.open(CHAPTER);
  await manuscript.read("source");
  await expect.poll(async () => manuscript.chipsThrough()).toEqual(CHIPS);

  await expect.poll(async () => book.holds(BOOK)).toBe(1);

  await manuscript.close();

  // Nothing holds the book now, so the pool has it on the grace and
  // stops it at the end of one.
  await expect.poll(async () => book.holds(BOOK)).toBe(0);
});

// What this suite does not cover: a book that will not set, which is
// asked about once and then drawn as plain text, since every book in
// the fixture sets; the grace itself and the ceiling, which run on a
// clock and are proven in the pool tests against an injected one, so
// what a spec here reads is the hold rather than the worker that
// outlives it.
