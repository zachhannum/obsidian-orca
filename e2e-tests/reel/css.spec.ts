import type { Locator } from "@playwright/test";
import { rowsIn } from "../harness/frames";
import { Inspect } from "../harness/inspect";
import { PREVIEW } from "../harness/book";
import { still } from "../harness/box";
import { BOOK as NOTE } from "../harness/note";
import { expect, test } from "../harness/test";

/** The folder the sample book keeps its notes in, the book note, and the chapter a sound session is known by. */
const FOLDER = "Twenty Thousand Leagues";
const BOOK = `${FOLDER}/Twenty Thousand Leagues Under the Sea.md`;
const CHAPTER = "A Shifting Reef";
const OPENS = 8;

/**
 * The last note of the book, the folio its spread opens on, the page
 * it is set on, and the words its first paragraph begins with.
 */
const COLOPHON = "Colophon";
const SPREAD = 334;
const LAST = 335;
const PARAGRAPH = "The plate facing";

/** The width the design panel is given, which holds a rule on one line. */
const PANEL = 440;

/** The rule the take writes, and the element orca names for a paragraph of the colophon. */
const SELECTOR = "section#colophon > p";
const DECLARATIONS = ["text-align: center;", "text-indent: 0;", "font-style: italic;"];

/** The rule as the editor leaves it in the note, and the indent of the design panel's rule it wins over. */
const WRITTEN = `${SELECTOR} {\n  ${DECLARATIONS.join("\n  ")}\n}`;
const INDENT = "text-indent: 1.2em";

/**
 * The rule the sample book sets the colophon's paragraphs with. The
 * take starts from the book without it, and writes it again from the
 * inspect pane.
 */
const OWN = `section#colophon p {
  text-align: center;
  text-indent: 0;
  font-style: italic;
  margin-bottom: 6pt;
}

`;

/** The book note without the rule for the colophon's paragraphs. */
function plain(book: string): string {
  if (!book.includes(OWN)) throw new Error("the book note has no rule for the colophon's paragraphs");
  for (const declaration of DECLARATIONS) {
    if (!OWN.includes(declaration)) throw new Error(`the book's rule has no ${declaration}`);
  }
  return book.replace(OWN, "");
}

/** Whether one element is drawn wholly inside another, which a scroller would otherwise hide part of. */
async function within(inner: Locator, outer: Locator): Promise<boolean> {
  const [box, frame] = [await inner.boundingBox(), await outer.boundingBox()];
  if (box === null || frame === null) return false;
  return box.y >= frame.y && box.y + box.height <= frame.y + frame.height;
}

test("the CSS reel pins a paragraph of the colophon and writes a rule for it", async ({ reel }) => {
  const { site, vault } = reel;
  const { obsidian, panel, book } = site;
  const inspect = new Inspect(obsidian);
  await reel.begin({ book: BOOK, chapter: CHAPTER, folio: OPENS });
  await vault.modify(BOOK, plain(await vault.read(BOOK)));
  await expect.poll(async () => vault.read(BOOK)).not.toContain(OWN);
  // A session that saw the book with the rule can set a chapter out of
  // its place. Orca is loaded again here, so the preview sets the book
  // from the note as it is on disk.
  await obsidian.reloadPlugin();
  await obsidian.open(BOOK);
  await book.open();
  await expect(book.surface).toBeVisible();
  await reel.opensOn(CHAPTER, OPENS);
  await reel.opensOn(COLOPHON, SPREAD);
  // The colophon is the spread's right page, and its left page is blank. One page shows it alone.
  await book.show("Single page", "single");
  await book.turnTo(LAST);
  await reel.settled();
  await expect(book.surface).toHaveAttribute("data-first", String(LAST));
  // The preview is the one tab in the middle, as it is in the hero.
  await obsidian.detach(NOTE);
  // The tab that is left slides into the room of the one that went.
  await still(obsidian.view(PREVIEW));

  await obsidian.put("left");
  await panel.open();
  await obsidian.sidebar(PANEL);
  await expect(panel.panel).toBeVisible();
  // A take before this one that failed can leave the panel on the book's CSS.
  if ((await panel.toControls.count()) > 0) await panel.toControls.click();
  await expect(panel.toCss).toBeVisible();
  // The status bar counts the words of the note that was last in
  // front until another tab is. The panel's own tab is one.
  await panel.focus();
  await reel.settled();

  try {
    const line = inspect.line(LAST, PARAGRAPH);
    const pane = panel.pane;

    // Inspect mode, and the paragraph under the pointer.
    await reel.frame("c0", { inspect: inspect.action });
    await inspect.on();
    await reel.frame("c1", { inspect: inspect.action, para: line });
    await inspect.hoverLine(line);
    await reel.frame("c2", { para: line }, { hovered: true });

    // The pin turns the panel to the book's CSS, under the pane. The
    // pane holds this paragraph's rules without scrolling.
    await inspect.pinLine(line);
    const pin = await inspect.pinned();
    await panel.inspecting(pin.key, pin.generation);
    await expect(panel.selector).toHaveText(SELECTOR);
    await expect(panel.rulesIn("design").first()).toContainText(INDENT);
    await expect(panel.editor).toBeVisible();
    expect(await within(panel.addRule, pane)).toBe(true);
    await reel.frame("c3", { add: panel.addRule, pane, para: line });

    // The empty rule, with the caret on the line between its braces.
    await panel.add();
    await expect.poll(async () => vault.read(BOOK)).toContain(`${SELECTOR} {`);
    await reel.settled();
    await reel.frame(
      "c4",
      { code: panel.editor, caret: panel.caretLine, pane },
      { paint: panel.editor },
    );

    // The declarations, and the page they set.
    const before = await book.painted();
    await panel.code.pressSequentially(DECLARATIONS.join("\n"));
    await expect.poll(async () => vault.read(BOOK)).toContain(WRITTEN);
    await expect.poll(async () => book.painted()).toBeGreaterThan(before);
    await reel.settled();
    const set = await inspect.pinned();
    await panel.inspecting(set.key, set.generation);
    await expect(panel.rulesIn("own").first()).toContainText(DECLARATIONS[0] ?? "");
    // The editor draws the rule's own line first, then one row for each declaration.
    const rows = await rowsIn(panel.editor);
    expect(rows.length).toBeGreaterThan(DECLARATIONS.length);
    await reel.frame(
      "c5",
      {
        code: panel.editor,
        rule: panel.rulesIn("own").first(),
        close: panel.unpinButton,
        pane,
        para: line,
      },
      { rows: rows.slice(1, DECLARATIONS.length + 1) },
    );

    // The pin comes off, and the page is clear of its outline.
    await panel.unpinButton.click();
    await inspect.unpinned();
    await expect(pane).toHaveCount(0);
    await reel.frame("c6", { code: panel.editor, inspect: inspect.action, para: line });
  } finally {
    // One app runs every take of a shard, so the panel goes back to its
    // controls and inspect mode goes off, after a take that failed as well.
    if ((await inspect.action.getAttribute("aria-pressed")) === "true") await inspect.off();
    if ((await panel.toControls.count()) > 0) await panel.toControls.click();
  }
  await reel.end();
});

// What this spec does not cover: whether the player shows each frame
// where its marks put it, which a look at the landing page answers; the
// frames on any platform but the one they were taken on; a rule typed
// with a mistake in it, which the engine flags and the take never
// writes; and a book whose colophon moves off the last page, which
// stops the take rather than being set right.
