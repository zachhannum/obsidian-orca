import { expect, test } from "./harness/test";

/** The fixture chapter written in every form an attribute run takes. */
const CHAPTER = "Chapter Fifteen.md";

/** A note the fixture book does not list. */
const OUTSIDE = "A note on the text.md";

/** Every chip the chapter carries, in the order the note writes them. */
const CHIPS = [
  "#fifteen .chapter-opening",
  "#entail .plain",
  ".character",
  ".epigraph",
  ".plate",
];

test("Live Preview draws a chip over every run, and the cursor shows the line it is on", async ({
  manuscript,
}) => {
  await manuscript.open(CHAPTER);
  await manuscript.read("source");

  await expect.poll(async () => manuscript.chips()).toEqual(CHIPS);

  // The heading text ends before its run, and no text follows the
  // image.
  await expect(manuscript.pane).toContainText("The Entail");
  await expect(manuscript.pane).not.toContainText("{.plain #entail}");
  await expect(manuscript.pane).not.toContainText("{.plate}");
  // The span keeps its words and loses its brackets.
  await expect(manuscript.pane).toContainText("Elizabeth, equally next to Jane");
  await expect(manuscript.pane).not.toContainText("[Elizabeth]");

  // The line the cursor is on shows its source, and the rest keep
  // their chips.
  await manuscript.place({ line: 5, ch: 0 });

  await expect(manuscript.pane).toContainText("{.chapter-opening #fifteen}");
  await expect
    .poll(async () => manuscript.chips())
    .toEqual(CHIPS.filter((chip) => chip !== "#fifteen .chapter-opening"));
});

test("Live Preview draws a setext heading at the level of its underline", async ({
  manuscript,
}) => {
  await manuscript.open(CHAPTER);
  await manuscript.read("source");

  await expect.poll(async () => manuscript.chips()).toEqual(CHIPS);

  // One line over `=` is a heading of level 1, and two lines over `-`
  // are one heading of level 2.
  const level = async (said: string): Promise<string[]> =>
    manuscript.pane
      .locator(".cm-line.orca-setext", { hasText: said })
      .evaluateAll((lines) =>
        lines.map((line) => (line.className.match(/orca-setext-\d/) ?? [""])[0]),
      );

  await expect.poll(async () => level("The Parsonage")).toEqual(["orca-setext-1"]);
  await expect
    .poll(async () => level("Longbourn, in the Spring"))
    .toEqual(["orca-setext-2"]);
  // The underline is still a line to type on.
  await expect(manuscript.pane.locator(".cm-line.orca-setext-under")).toHaveCount(2);
});

test("reading view draws the same chips, and the setext heading with no underline", async ({
  manuscript,
}) => {
  await manuscript.open(CHAPTER);

  await manuscript.read("preview");

  await expect.poll(async () => manuscript.chips()).toEqual(CHIPS);
  await expect
    .poll(async () => manuscript.headings())
    .toEqual(["h1:The Parsonage", "h2:A Morning CallLongbourn, in the Spring"]);
  await expect(manuscript.pane).not.toContainText("=============");
  await expect(manuscript.pane).not.toContainText("------------------------");
});

test("a note no book lists is drawn as Obsidian draws it", async ({
  manuscript,
  vault,
}) => {
  await vault.write(OUTSIDE, "{.epigraph}\n\nA paragraph.\n\nOne\n===\n");
  await manuscript.open(OUTSIDE);
  await manuscript.read("source");

  await expect(manuscript.pane).toContainText("{.epigraph}");
  await expect(manuscript.runs).toHaveCount(0);
});

test("a run the engine does not read stays the prose the author typed", async ({
  manuscript,
  vault,
}) => {
  // An element answers to one name, so a second id is no run at all.
  await vault.modify(CHAPTER, "{#one #two}\n\nA paragraph.\n");
  await manuscript.open(CHAPTER);
  await manuscript.read("source");

  await expect(manuscript.pane).toContainText("{#one #two}");
  await expect(manuscript.runs).toHaveCount(0);
});

test("a chip stays on its run while the author types, before the next parse", async ({
  manuscript,
  vault,
}) => {
  vault.touch(CHAPTER);
  await manuscript.open(CHAPTER);
  await manuscript.read("source");
  await expect.poll(async () => manuscript.chips()).toEqual(CHIPS);

  // The typing is ahead of the engine, and the chips already on the
  // text move with it rather than flickering off.
  await manuscript.place({ line: 8, ch: 0 });
  await manuscript.type("A new opening sentence. ");

  await expect(manuscript.runs).toHaveCount(CHIPS.length);
  await expect.poll(async () => manuscript.chips()).toEqual(CHIPS);
});
