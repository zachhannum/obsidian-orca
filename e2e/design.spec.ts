import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PREVIEW } from "./harness/book";
import type { Obsidian } from "./harness/obsidian";
import { expect, test } from "./harness/test";
import type { Vault } from "./harness/vault";

/** The fixture family whose faces come in more than one variant. */
const VARIED = "Junicode";

/** Junicode's default variant, and its condensed one. */
const DEFAULT_VARIANT = "Regular";
const CONDENSED = "Cond";

/** The name the engine's font table gives a face of the condensed variant. */
const CONDENSED_FACE = /^Junicode[ -]?Cond/;

/** A word of the fixture chapter's heading, and words of its body. */
const HEADING_WORD = "Twelve";
const BODY_WORDS = /\b(the|and|of)\b/;

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The fixture chapter as the toolbar names it. Its heading is a level 1 heading. */
const CHAPTER_NAME = "Chapter Twelve";

/** A folio, or a span of them. */
const FOLIO = /^\d+(–\d+)?$/;

/** The note that chapter is read from. */
const CHAPTER_NOTE = "Chapter Twelve.md";
const LOOSE_NOTE = "Loose.md";

/** The font the fixture vault ships, and the one the specs pick. */
const FIXTURE_FONT = "Alegreya";

/** A font no machine installs, so the filter matches nothing. */
const NOWHERE = "Zzyzx Grotesque";

/** The font the engine carries, which a book is set in until one is picked. */
const CARRIED = "EB Garamond";

/** A right sidebar narrower than the panel's artboard, in pixels. */
const NARROW = 260;

test("the picker offers the fonts the scan found, and typing narrows them", async ({
  book,
  panel,
}) => {
  await book.open();
  const painted = await book.settled(BOOK);
  await panel.open();

  expect(await panel.reading()).toContain(CARRIED);

  await panel.pick();
  const all = await panel.offering();
  // Nothing crosses to fill the list, so the pages are still the ones
  // painted before the picker opened.
  expect(await book.painted()).toBe(painted);
  // The vault's own font is in the list, alongside whatever the
  // machine installs.
  expect(all).toBeGreaterThan(0);
  await expect(panel.options.filter({ hasText: FIXTURE_FONT })).toHaveCount(1);

  await panel.type("aleg");
  expect(await panel.offering()).toBeLessThan(all);
  expect(await panel.offered()).toContain(FIXTURE_FONT);
});

test("text matching nothing does not commit, so the book keeps the font it has", async ({
  book,
  panel,
}) => {
  await book.open();
  const painted = await book.painted();
  await panel.open();
  await panel.pick();

  await panel.type(NOWHERE);
  await expect(panel.nothing).toBeVisible();
  expect(await panel.offering()).toBe(0);

  await panel.filter.press("Enter");
  // The field still shows the font the book was set in, and no render
  // went out.
  expect(await panel.reading()).toContain(CARRIED);
  expect(await book.painted()).toBe(painted);
});

test("picking a font sets the book in it, and warns of nothing the machine has", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  await book.open();
  const painted = await book.painted();
  await panel.open();
  await panel.pick();

  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();

  await expect(panel.font).toContainText(FIXTURE_FONT);
  // The pick is an edit, so the pages come back under a later
  // generation than the one they were painted at.
  await expect
    .poll(async () => book.painted())
    .toBeGreaterThan(painted);

  // The machine has the font, so there is no warning.
  await expect(panel.missing).toHaveCount(0);

  await written(vault, own);
});

test("picking the font the book is set in again keeps the book in it", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();
  await expect(panel.font).toContainText(FIXTURE_FONT);

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();

  // The registry keys the bytes by content, so the second pick sends
  // nothing new. The book stays in the font, and there is no warning.
  await expect(panel.font).toContainText(FIXTURE_FONT);
  await expect(panel.missing).toHaveCount(0);

  await written(vault, own);
});

test("a book note written while a pane reads it leaves the panel designing that book", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  await book.open();
  const painted = await book.painted();
  await panel.open();
  const font = (await panel.reading()).trim();

  // A note written from outside Obsidian takes the book off the
  // composer, and the pane sets it again from the notes as they now
  // are. The book the pane reads is the one the panel designs.
  await vault.modify(BOOK, await vault.read(BOOK));
  await panel.focus();

  await expect(panel.panel).toBeVisible();
  await expect(panel.font).toContainText(font);

  // And a pick still reaches the book on screen.
  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();
  await expect(panel.font).toContainText(FIXTURE_FONT);
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);

  await written(vault, own);
});

test("a second preview in a background tab is deferred, and the panel designs the drawn one", async ({
  book,
  obsidian,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  await book.open();
  await book.painted();
  // A second pane on the same book, so the first is a background tab.
  await book.again();
  await expect(book.panes).toHaveCount(2);

  // A workspace reopened defers every tab nothing has asked for, so the
  // background pane's view is not the preview until it is drawn.
  const layout = await obsidian.layout();
  await obsidian.reopen(layout);
  // Only the drawn pane is in the document: the background tab is
  // deferred until something asks for it.
  await expect(book.panes).toHaveCount(1);
  await book.painted();

  await panel.open();
  await panel.focus();

  await expect(panel.panel).toBeVisible();
  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();
  await expect(panel.font).toContainText(FIXTURE_FONT);

  await written(vault, own);
});

test("a font picked is written into the book note, so the book opens in it", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.pick();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();
  await expect(panel.font).toContainText(FIXTURE_FONT);

  // The design is the book note's own frontmatter, so the pick is there
  // rather than only on the engine.
  await expect.poll(async () => vault.read(BOOK)).toContain(
    `body-font: ${FIXTURE_FONT}`,
  );

  await written(vault, own);
});

test("a heading font picked in the panel is still the headings' font after Obsidian reloads", async ({
  obsidian,
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.control("heading-1-font").click();
  await panel.type("aleg");
  await panel.options.filter({ hasText: FIXTURE_FONT }).first().click();
  await expect(panel.control("heading-1-font")).toContainText(FIXTURE_FONT);
  await expect.poll(async () => vault.read(BOOK)).toContain(
    `heading-1-font: ${FIXTURE_FONT}`,
  );

  // A reload stops the engine, so the book is set from its note on a
  // new one, which has none of the faces the pick sent.
  await obsidian.reload();
  await book.open();
  await book.painted();
  await book.choose(CHAPTER_NAME);

  // A painted run names its face's family after the face's own id, so
  // the heading reads in the fixture's font only if its faces crossed.
  const heading = book.surface.locator("text").filter({ hasText: "Twelve" });
  await expect
    .poll(async () => heading.evaluateAll((runs) =>
      runs.map((run) => run.getAttribute("font-family") ?? ""),
    ))
    .toContainEqual(expect.stringContaining(FIXTURE_FONT.toLowerCase()));

  await panel.open();
  await expect(panel.control("heading-1-font")).toContainText(FIXTURE_FONT);
  await expect(panel.missing).toHaveCount(0);

  await written(vault, own);
});

test("the Variant row shows under the Font row for a family with more than one variant, and lists the variants the index found", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.chooseFont("body-font", VARIED);
  const variant = panel.control("body-font-variant");
  await expect(variant).toBeVisible();
  // No variant is picked, so the row names the default in faint type.
  await expect(variant).toHaveText(DEFAULT_VARIANT);
  await expect(variant).toHaveAttribute("data-default", "true");
  // The row sits directly under the Font row.
  expect((await panel.placed("body-font-variant")).y).toBeGreaterThan(
    (await panel.placed("font")).y,
  );

  await variant.click();
  expect(await panel.variants()).toEqual([DEFAULT_VARIANT, CONDENSED, "Exp"]);

  await written(vault, own);
});

test("a family with one variant shows no Variant row", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.chooseFont("body-font", VARIED);
  await expect(panel.control("body-font-variant")).toBeVisible();

  await panel.chooseFont("body-font", FIXTURE_FONT);
  await expect(panel.control("body-font-variant")).toHaveCount(0);
  await expect.poll(async () => vault.read(BOOK)).toContain(
    `body-font: ${FIXTURE_FONT}`,
  );
  expect(await vault.read(BOOK)).not.toContain("body-font-variant:");

  await written(vault, own);
});

test("a picked variant is stored with its family, and the book reads it back after it opens again", async ({
  obsidian,
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.chooseFont("body-font", VARIED);
  await panel.chooseVariant("body-font", CONDENSED);
  await expect.poll(async () => vault.read(BOOK)).toContain(
    `body-font-variant: ${CONDENSED}`,
  );
  expect(await vault.read(BOOK)).toContain(`body-font: ${VARIED}`);

  // A reload stops the engine, so the book is set from its note again.
  await obsidian.reload();
  await book.open();
  await book.painted();
  await panel.open();

  await expect(panel.font).toContainText(VARIED);
  await expect(panel.control("body-font-variant")).toHaveText(CONDENSED);
  await expect(panel.control("body-font-variant")).toHaveAttribute("data-default", "false");
  await expect(panel.missing).toHaveCount(0);

  await written(vault, own);
});

test("the body and a heading set in two variants of one family in the same book", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.chooseFont("body-font", VARIED);
  await panel.chooseFont("heading-1-font", VARIED);
  await panel.chooseVariant("heading-1-font", CONDENSED);
  await expect.poll(async () => vault.read(BOOK)).toContain(
    `heading-1-font-variant: ${CONDENSED}`,
  );
  await book.choose(CHAPTER_NAME);

  // The heading is set in the condensed cut and the body in the regular one.
  await expect
    .poll(async () => book.facesOf(BOOK, HEADING_WORD))
    .toContainEqual(expect.stringMatching(CONDENSED_FACE));
  // One read answers both questions, so an empty read between two sets
  // of the book cannot pass the second one.
  await expect
    .poll(async () => {
      const body = await book.facesOf(BOOK, BODY_WORDS);
      return (
        body.some((name) => /^Junicode[ -](Regular|Bold|Italic)$/.test(name)) &&
        !body.some((name) => /Cond|Exp/.test(name))
      );
    })
    .toBe(true);

  await written(vault, own);
});

test("the preview and the PDF set the picked variant, and the preview draws the face the PDF embeds", async ({
  book,
  note,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.chooseFont("body-font", VARIED);
  await panel.chooseVariant("body-font", CONDENSED);
  // The book note page reads its folios off the same session, and the
  // faces the design registers stay registered.
  await note.beside(BOOK);
  await expect(note.pages(CHAPTER_NAME)).toHaveText(FOLIO);
  await book.choose(CHAPTER_NAME);

  // The faces the PDF is held to are the ones the passing read saw.
  let painted = new Set<string>();
  await expect
    .poll(async () => {
      painted = new Set(await book.facesOf(BOOK, BODY_WORDS));
      const names = [...painted];
      return (
        names.some((name) => CONDENSED_FACE.test(name)) &&
        !names.some((name) => /^Junicode/.test(name) && !/Cond/.test(name))
      );
    })
    .toBe(true);

  const pdfPath = path.join(await mkdtemp(path.join(tmpdir(), "orca-variant-")), "book.pdf");
  await writeFile(pdfPath, await book.pdf(BOOK));
  const embedded = execFileSync("pdffonts", [pdfPath], { encoding: "utf8" });
  // The font table names a face with spaces and the PDF with hyphens, so
  // both are compared with neither.
  const squashed = embedded.replace(/[\s-]/g, "");
  for (const name of painted) {
    if (name.startsWith("Junicode")) expect(squashed).toContain(name.replace(/[\s-]/g, ""));
  }
  expect(embedded).not.toMatch(/Junicode-(Regular|Bold|Italic|Exp)/);

  await note.close();
  await written(vault, own);
});

test("a picker row and a variant row preview in their own faces", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await panel.pick();
  await panel.type(VARIED);
  const row = panel.option(VARIED);
  await expect
    .poll(async () => panel.drawnIn(row))
    .toEqual({ family: `orca-preview ${VARIED}`, loaded: true });
  await row.click();
  await expect(panel.font).toContainText(VARIED);

  await panel.control("body-font-variant").click();
  const condensed = panel.variant(CONDENSED);
  await expect
    .poll(async () => panel.drawnIn(condensed))
    .toEqual({ family: `orca-preview ${VARIED} ${CONDENSED}`, loaded: true });
  await expect
    .poll(async () => panel.drawnIn(panel.variant(DEFAULT_VARIANT)))
    .toEqual({ family: `orca-preview ${VARIED}`, loaded: true });

  await written(vault, own);
});

test("the panel offers every group a book designer works in", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  expect(await panel.grouped()).toEqual([
    "Page",
    "Text",
    "Headings",
    "Chapter openings",
    "Scene breaks",
    "Heads & folios",
    "Page breaks",
  ]);
});

test("a click on a switch flips it, and the note is written", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  // The fixture hyphenates, so the switch starts on.
  const hyphens = panel.control("body-hyphens");
  await expect(hyphens).toHaveAttribute("aria-checked", "true");
  await hyphens.click();

  await expect(hyphens).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => vault.read(BOOK)).toContain(
    "body-hyphens: false",
  );

  await written(vault, own);
});

test("the CSS view edits the book's own fence, and the edit reaches the pages and the note", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  const before = await book.painted();
  await panel.open();

  // The header icons sit in the middle of the square their hover draws.
  expect(await panel.offCenter(panel.toCss)).toBeLessThanOrEqual(0.5);
  await panel.toCss.click();
  await expect(panel.editor).toBeVisible();
  expect(await panel.offCenter(panel.toControls)).toBeLessThanOrEqual(0.5);
  expect(await panel.offCenter(panel.wrap)).toBeLessThanOrEqual(0.5);
  await expect(panel.code).toContainText("letter-spacing: 0.02em;");
  // CodeMirror owns its DOM, so the editor is not under the React root.
  expect(await panel.editorInReact()).toBe(false);

  // The author's sheet crosses after the generated layer, which indents
  // with the same selector, so this rule wins and the pages show it.
  const typed = "\np + p { text-indent: 4em; }";
  await panel.typeCss(typed);

  await expect.poll(async () => vault.read(BOOK)).toContain(typed);
  await expect.poll(async () => book.painted()).toBeGreaterThan(before);
  // The edit is inside the fence, and every other line is as it was.
  expect((await vault.read(BOOK)).replace(typed, "")).toBe(own);

  await panel.toControls.click();
  await expect(panel.editor).toBeHidden();
  await expect(panel.groups.first()).toBeVisible();

  await written(vault, own);
});

test("a control the author's CSS overrides dims and names the line that overrides it", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  const before = await book.painted();
  await panel.open();
  const key = "body-first-line-indent";
  const row = panel.row(key);
  await expect(row).not.toHaveAttribute("data-overridden");
  await expect(panel.overridden(key)).toHaveCount(0);

  await panel.toCss.click();
  await expect(panel.editor).toBeVisible();
  const typed = "\np + p { text-indent: 0; }";
  await panel.typeCss(typed);
  await expect.poll(async () => vault.read(BOOK)).toContain(typed);
  await expect.poll(async () => book.painted()).toBeGreaterThan(before);
  const line = (await panel.lineNumbers.last().textContent()) ?? "";

  await panel.toControls.click();
  await expect(row).toHaveAttribute("data-overridden", line);
  await expect(panel.reset(key)).toHaveCount(0);
  await expect(row.locator(".orca-panel-label")).toHaveCSS("opacity", "0.42");
  await expect(panel.control(key)).toBeVisible();

  // A hover over the lock names the property, the value that beats it and its place.
  await expect(panel.overriddenCard).toBeHidden();
  await panel.overridden(key).hover();
  await expect(panel.overriddenCard).toBeVisible();
  await expect(panel.overriddenCard).toContainText("text-indent");
  await expect(panel.overriddenCard).toContainText("is overridden with value");
  await expect(panel.overriddenCard).toContainText("0");
  await expect(panel.overriddenCard).toContainText(`book.css:${line}:`);
  // Obsidian draws an aria-label as its own tooltip over the card, so the lock names itself in text.
  await expect(panel.overridden(key)).not.toHaveAttribute("aria-label");
  await expect(panel.overridden(key)).toHaveAccessibleName(`Overridden by line ${line} of the book's CSS`);
  await panel.control(key).hover();
  await expect(panel.overriddenCard).toBeHidden();

  // The lock is the way to the line.
  await panel.overridden(key).click();
  await expect(panel.panel).toHaveAttribute("data-viewing", "css");
  await expect(panel.caretLine).toHaveText(line);

  // Taking the rule out gives the control back.
  const painted = await book.painted();
  await panel.code.press("ControlOrMeta+End");
  for (let at = 0; at < typed.length; at += 1) await panel.code.press("Backspace");
  await expect.poll(async () => vault.read(BOOK)).not.toContain(typed);
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  await panel.toControls.click();
  await expect(row).not.toHaveAttribute("data-overridden");
  await expect(panel.overridden(key)).toHaveCount(0);

  await written(vault, own);
});

test("a long line in the CSS view scrolls sideways until the author wraps it", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();
  await panel.toCss.click();
  await expect(panel.editor).toBeVisible();

  const long = `\n/* ${"a long comment ".repeat(20)}*/`;
  await panel.typeCss(long);
  await expect(panel.wrap).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => panel.scrollsSideways()).toBe(true);

  await panel.wrap.click();
  await expect(panel.wrap).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => panel.scrollsSideways()).toBe(false);

  await panel.wrap.click();
  await panel.toControls.click();
  await expect.poll(async () => vault.read(BOOK)).toContain(long);
  await written(vault, own);
});

test("a declaration the engine cannot set is flagged on its line in the CSS view, and listed in the preview", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();
  await panel.toCss.click();
  await expect(panel.editor).toBeVisible();
  await expect(panel.flags).toHaveCount(0);
  await expect(panel.warned).toBeHidden();

  const typed = "\np { float: left; }";
  await panel.typeCss(typed);
  await expect.poll(async () => vault.read(BOOK)).toContain(typed);

  // The squiggle arrives with the render that set the typed rule, on
  // the last line, which is where it was typed.
  await expect(panel.flags).toHaveCount(1);
  await expect(panel.flags).toHaveText(/^float: left;?$/);
  await expect(panel.flaggedLines).toHaveCount(1);
  const line = (await panel.lineNumbers.last().textContent()) ?? "";
  await expect(panel.flaggedLines).toHaveText(line);
  await expect(panel.warned).toHaveText("1 warning");

  // The squiggle opens a card with the engine's own words and the
  // place they name, drawn by orca rather than the browser.
  await expect(panel.flags).not.toHaveAttribute("title", /./);
  await expect(panel.card).toBeHidden();
  await panel.flags.hover();
  await expect(panel.card).toBeVisible();
  await expect(panel.card).toContainText("float");
  await expect(panel.card).toContainText(`book.css:${line}:`);

  // The same warning is one of the preview's, with the same place.
  await expect(book.warnings).toHaveText("1 warning");
  await book.warnings.click();
  await expect(book.issues.first()).toContainText("float");
  await expect(book.issueOpens.first()).toHaveText(new RegExp(`^book\\.css:${line}:\\d+$`));
  await expect(book.issueGroups.first()).toContainText("The book's CSS");

  // Its line opens the CSS view with the caret on that line, from the
  // controls as well.
  await panel.toControls.click();
  await expect(panel.editor).toBeHidden();
  await book.issueOpens.first().click();
  await expect(panel.editor).toBeVisible();
  await expect(panel.caretLine).toHaveText(line);
  await book.warnings.click();

  await panel.toControls.click();
  await written(vault, own);
});

test("at the width of a narrow sidebar every control fits the panel", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  const had = await panel.resize(NARROW);
  try {
    await expect.poll(async () => panel.width()).toBeLessThanOrEqual(NARROW);
    expect(await panel.overflowing()).toEqual([]);
    expect(await panel.beyond()).toEqual([]);
  } finally {
    await panel.resize(had);
  }
});

test("a key the book does not set is drawn at its default, in faint type", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  // The fixture sets no space below a chapter's title.
  const below = panel.control("chapter-space-below");
  await expect(below).toHaveValue("0");
  await expect(below).toHaveAttribute("data-default", "true");
  await expect(below).toHaveClass(/is-default/);
  await expect(panel.reset("chapter-space-below")).toHaveCount(0);

  // A key the fixture sets shows its own value and a reset.
  await expect(panel.control("chapter-drop-cap")).toHaveAttribute(
    "data-default",
    "false",
  );
  await expect(panel.reset("chapter-drop-cap")).toBeVisible();
});

test("the reset takes a key out of the note, and the field shows the default", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  const size = panel.control("body-size");
  await expect(size).toHaveValue("10.5pt");
  await expect(panel.reset("body-size")).toHaveAttribute(
    "aria-label",
    "Reset to default (11pt)",
  );
  await panel.reset("body-size").click();

  await expect.poll(async () => vault.read(BOOK)).not.toContain("body-size:");
  await expect(size).toHaveValue("11pt");
  await expect(size).toHaveAttribute("data-default", "true");
  await expect(panel.reset("body-size")).toHaveCount(0);

  await written(vault, own);
});

test("the stepper moves a count by one line, and the note is written", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  await expect(panel.control("chapter-space-above")).toHaveValue("7");
  await expect(panel.up("chapter-space-above")).toHaveAttribute(
    "aria-label",
    "Increase by 1 line",
  );
  await panel.up("chapter-space-above").click();

  await expect.poll(async () => vault.read(BOOK)).toContain(
    "chapter-space-above: 8",
  );
  await expect(panel.control("chapter-space-above")).toHaveValue("8");

  await written(vault, own);
});

test("text a number field cannot read says what is wrong and writes nothing", async ({
  book,
  panel,
  vault,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  const top = panel.control("margin-top");
  await top.fill("12px");
  await top.press("Enter");

  await expect(panel.invalid("margin-top")).toHaveText(
    "Use one of these units: pt, pc, in, mm, cm, em.",
  );
  // The text stays in the field and is marked as not valid.
  await expect(top).toHaveValue("12px");
  await expect(top).toHaveAttribute("aria-invalid", "true");
  // Orca wrote nothing, so the note keeps the margin it had.
  expect(await vault.read(BOOK)).toContain("margin-top: 0.8in");

  // Escape restores the value the field had.
  await top.press("Escape");
  await expect(panel.invalid("margin-top")).toHaveCount(0);
  await expect(top).toHaveValue("0.8in");
});

test("the Headings group sets the level its tab is on", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  // A level is a tab over the rows under it, not a setting of its own.
  const levels = panel.control("heading-level");
  await expect(levels).toHaveAttribute("role", "tablist");
  await expect(levels).toHaveAttribute("data-on", "1");
  await expect(panel.choice("heading-level", "1")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panel.choice("heading-level", "6")).toHaveAttribute(
    "role",
    "tab",
  );

  await panel.choice("heading-level", "2").click();
  await expect(levels).toHaveAttribute("data-on", "2");
  await expect(panel.choice("heading-level", "2")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panel.choice("heading-level", "1")).toHaveAttribute(
    "aria-selected",
    "false",
  );

  const size = panel.control("heading-2-size");
  await expect(size).toHaveValue("13pt");
  await size.fill("15pt");
  await size.press("Enter");

  await expect.poll(async () => vault.read(BOOK)).toContain(
    "heading-2-size: 15pt",
  );

  await written(vault, own);
});

test("a control writes its key into the note, and the book is set again under it", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  const painted = await book.painted();
  await panel.open();

  // The fixture is set justified, so ragged right is a change the
  // pages show.
  await expect(panel.control("body-align")).toHaveAttribute(
    "data-on",
    "justify",
  );
  await panel.choice("body-align", "left").click();

  await expect(panel.control("body-align")).toHaveAttribute("data-on", "left");
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  await expect.poll(async () => vault.read(BOOK)).toContain("body-align: left");

  await written(vault, own);
});

test("the hyphenation switch says which language the engine will hyphenate in", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  // The engine reads no language property, so the panel shows the
  // book's own language and not one from the design.
  await expect(panel.said("body-hyphens")).toContainText("en-GB");
  await expect(panel.said("body-hyphens")).toContainText("English");
});

test("the book note's page draws the design read-only, in the panel's words", async ({
  note,
}) => {
  await note.open(BOOK);
  await note.painted();

  await expect(note.summed("Trim")).toContainText("Digest");
  await expect(note.summed("Margins")).toContainText("0.95in inside");
  await expect(note.summed("Chapters begin on")).toContainText(
    "Right-hand page",
  );
  // Nothing on the page edits the design, and nothing opens the panel.
  await expect(
    note.design.locator("input, select, [role='switch']"),
  ).toHaveCount(0);
  await expect(note.page.getByText("Open the design panel")).toHaveCount(0);
});

test("opening a preview reveals the design panel", async ({
  book,
  obsidian,
  panel,
}) => {
  await panel.close();
  await obsidian.collapse("right");
  expect(await obsidian.collapsed("right")).toEqual(true);

  await book.open();
  await book.painted();

  await expect(panel.leaf).toBeVisible();
  await expect.poll(async () => obsidian.collapsed("right")).toEqual(false);
});

test("a chapter note in front of the preview keeps the panel on the book", async ({
  book,
  obsidian,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();
  await expect(panel.panel).toBeVisible();

  // A note in a tab in front of the preview hides it. The note is the
  // book on screen, so the panel designs it still.
  await opensInTab(obsidian, CHAPTER_NOTE);
  await expect(panel.panel).toBeVisible();
  await expect(panel.panel).toContainText("Pride and Prejudice");

  await obsidian.page.evaluate(async (type) => {
    const leaf = window.app.workspace.getLeavesOfType(type)[0];
    if (leaf === undefined) throw new Error("no preview is open");
    await window.app.workspace.revealLeaf(leaf);
    window.app.workspace.setActiveLeaf(leaf, { focus: true });
  }, PREVIEW);
  await expect(panel.panel).toBeVisible();
  await obsidian.detach("markdown");
});

test("a note no book reads shows the panel no book", async ({
  book,
  obsidian,
  panel,
  vault,
}) => {
  await vault.write(LOOSE_NOTE, "# Loose\n\nA note no book reads.\n");
  await book.open();
  await book.painted();
  await panel.open();
  await expect(panel.panel).toBeVisible();

  await opensInTab(obsidian, LOOSE_NOTE);
  await expect(panel.empty).toHaveText("No book is open");

  await obsidian.detach("markdown");
  await vault.remove(LOOSE_NOTE);
});

test("a chapter note sets the book the panel designs, with no preview open", async ({
  obsidian,
  panel,
}) => {
  // No preview has set this book, so the note on screen is what sets
  // it. The panel opens on the book rather than on "No book is open".
  await opensInTab(obsidian, CHAPTER_NOTE);
  await panel.open();
  await expect(panel.panel).toContainText("Pride and Prejudice");

  await obsidian.detach("markdown");
});

/** Opens a note in a tab of its own, in front of whatever that pane held. */
async function opensInTab(obsidian: Obsidian, at: string): Promise<void> {
  await obsidian.page.evaluate(async (path) => {
    const note = window.app.vault.getFileByPath(path);
    if (note === null) throw new Error(`${path} is not in the vault`);
    await window.app.workspace.getLeaf("tab").openFile(note);
  }, at);
}

test("a click low in the panel leaves it scrolled where it was", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  let painted = await book.painted();
  await panel.open();

  // A switch in Page breaks, the last group.
  const keep = panel.control("keep-heading-with-text");
  const was = await keep.getAttribute("aria-checked");
  const at = await panel.scrollTo(keep);
  expect(at).toBeGreaterThan(0);
  await keep.click();
  await expect(keep).not.toHaveAttribute("aria-checked", was ?? "");
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  await expect.poll(async () => vault.read(BOOK)).toContain(
    "keep-heading-with-text:",
  );
  expect(await panel.scrolled()).toEqual(at);

  // A segment in Heads & folios.
  painted = await book.painted();
  const format = panel.control("page-number-format");
  const there = await panel.scrollTo(format);
  expect(there).toBeGreaterThan(0);
  await panel.choice("page-number-format", "roman").click();
  await expect(format).toHaveAttribute("data-on", "roman");
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  await expect.poll(async () => vault.read(BOOK)).toContain(
    "page-number-format: roman",
  );
  expect(await panel.scrolled()).toEqual(there);

  await written(vault, own);
});

test("picking a custom trim shows the trim's sides, and a width typed writes the trim", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  const painted = await book.painted();
  await panel.open();

  const width = panel.control("trim-width");
  const height = panel.control("trim-height");
  await expect(width).toHaveCount(0);

  await panel.control("trim").selectOption({ label: "Custom" });

  // The fields start from the trim the book is in, in inches.
  await expect(width).toHaveValue("5.5in");
  await expect(height).toHaveValue("8.5in");

  await width.fill("6in");
  await width.press("Enter");

  await expect.poll(async () => vault.read(BOOK)).toContain("trim: 6in 8.5in");
  await expect.poll(async () => book.painted()).toBeGreaterThan(painted);
  await expect(width).toHaveValue("6in");

  await written(vault, own);
});

test("setting a key draws its reset without moving the control", async ({
  book,
  panel,
  vault,
}) => {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();

  // The fixture sets no header position.
  const position = panel.control("header-position");
  await expect(position).toHaveAttribute("data-default", "true");
  await expect(panel.reset("header-position")).toHaveCount(0);
  const before = await panel.placed("header-position");

  await panel.choice("header-position", "center").click();

  await expect(position).toHaveAttribute("data-on", "center");
  await expect(panel.reset("header-position")).toBeVisible();
  expect(await panel.placed("header-position")).toEqual(before);

  await written(vault, own);
});

test("with pages measured in millimeters, a margin field reads in millimeters", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();

  const top = panel.control("margin-top");
  await expect(top).toHaveValue("0.8in");

  // The unit is an orca setting, not a book setting, so the spec sets it
  // back to inches in every case.
  await panel.measure("mm");
  try {
    await expect(top).toHaveValue("20.32mm");
  } finally {
    await panel.measure("in");
  }
  await expect(top).toHaveValue("0.8in");
});

test("the panel is not a mode, so it stays when the book it designed closes", async ({
  book,
  panel,
}) => {
  await book.open();
  await book.painted();
  await panel.open();
  await expect(panel.panel).toBeVisible();

  await book.close();

  // The leaf stays in the sidebar with no book. It does not close with
  // the pane that had the book.
  await expect(panel.empty).toBeVisible();
});

/**
 * Puts the book note back through the vault, so a pick written into it
 * does not reach the next spec. The write takes the book off the
 * composer, and the next open sets it from the notes as they now are.
 */
async function written(vault: Vault, own: string): Promise<void> {
  vault.touch(BOOK);
  await vault.modify(BOOK, own);
}
