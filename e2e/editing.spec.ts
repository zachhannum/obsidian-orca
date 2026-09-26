import type { Book } from "./harness/book";
import type { Panel } from "./harness/panel";
import { expect, test } from "./harness/test";
import type { Vault } from "./harness/vault";

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** A family the fixture book sets text in, so a `font-family` value completes to it. */
const FAMILY = "Alegreya";

/** The keys that fold and unfold the rule at the caret, which differ by platform. */
const FOLD = process.platform === "darwin" ? "Meta+Alt+BracketLeft" : "Control+Shift+BracketLeft";
const UNFOLD = process.platform === "darwin" ? "Meta+Alt+BracketRight" : "Control+Shift+BracketRight";

test("the bracket beside the caret and the bracket that matches it are highlighted", async ({
  book,
  panel,
  vault,
}) => {
  const own = await opened(book, panel, vault);

  await panel.replaceCss("p { a: b; }");
  await panel.code.press("ControlOrMeta+End");
  await expect(panel.matchedBrackets).toHaveCount(2);
  await expect(panel.matchedBrackets.first()).toHaveText("{");
  await expect(panel.matchedBrackets.last()).toHaveText("}");
  await panel.code.press("ArrowLeft");
  await panel.code.press("ArrowLeft");
  await expect(panel.matchedBrackets).toHaveCount(0);

  await closed(panel, vault, own);
});

test("a bracket typed closes after the caret, and Enter and } indent a rule", async ({
  book,
  panel,
  vault,
}) => {
  const own = await opened(book, panel, vault);

  // Every closing character is typed, and each one steps over the one
  // the editor put in, so nothing is doubled.
  await panel.replaceCss('p { content: "a" attr(b) [c]; }');
  expect(await panel.cssText()).toBe('p { content: "a" attr(b) [c]; }');

  // Enter between the braces puts the closing one on its own line, and
  // the line between them is indented.
  await panel.replaceCss("h1 {\ncolor: red;");
  expect(await panel.cssText()).toBe("h1 {\n  color: red;\n}");

  // With the closing brace the editor put in taken out, a } typed on
  // the indented line after the declaration outdents it.
  await panel.replaceCss("h2 {");
  await panel.code.press("Delete");
  await panel.code.pressSequentially("\na: b;\n}");
  expect(await panel.cssText()).toBe("h2 {\n  a: b;\n}");

  await closed(panel, vault, own);
});

test("Tab indents lines and takes an open option, and Escape then Tab leaves the editor", async ({
  book,
  panel,
  vault,
}) => {
  const own = await opened(book, panel, vault);

  await panel.replaceCss("a: b;\nc: d;");
  await panel.code.press("ControlOrMeta+A");
  await panel.code.press("Tab");
  expect(await panel.cssText()).toBe("  a: b;\n  c: d;");
  await panel.code.press("Shift+Tab");
  expect(await panel.cssText()).toBe("a: b;\nc: d;");

  await panel.replaceCss(`h1 { font-family: ${FAMILY.slice(0, 4)}`);
  await expect(panel.completions.filter({ hasText: FAMILY })).toBeVisible();
  await panel.code.press("Tab");
  await expect(panel.completions).toHaveCount(0);
  expect(await panel.cssText()).toBe(`h1 { font-family: "${FAMILY}"}`);

  await panel.code.press("Escape");
  await panel.code.press("Tab");
  await expect(panel.code).not.toBeFocused();
  expect(await panel.cssText()).toBe(`h1 { font-family: "${FAMILY}"}`);

  await closed(panel, vault, own);
});

test("a marker in the gutter folds and unfolds a rule, and so do the fold keys", async ({
  book,
  panel,
  vault,
}) => {
  const own = await opened(book, panel, vault);

  await panel.replaceCss("p {\na: b;\nc: d;");
  await panel.gutters.hover();
  await expect(panel.foldMarkers).toHaveCount(1);
  await expect(panel.foldMarkers).toHaveCSS("color", await panel.resolves("--text-faint"));
  await panel.foldMarkers.click();
  await expect(panel.folded).toBeVisible();
  expect(await panel.cssText()).toBe("p {…}");
  // CodeMirror keeps a hidden marker of its own to size the gutter.
  await panel.unfoldMarkers.filter({ visible: true }).click();
  await expect(panel.folded).toHaveCount(0);
  expect(await panel.cssText()).toBe("p {\n  a: b;\n  c: d;\n}");

  await panel.code.click();
  await panel.code.press("ControlOrMeta+Home");
  await panel.code.press(FOLD);
  await expect(panel.folded).toBeVisible();
  await panel.code.press(UNFOLD);
  await expect(panel.folded).toHaveCount(0);

  await closed(panel, vault, own);
});

test("Mod-F opens a search panel that matches case, reads a regular expression and replaces", async ({
  book,
  panel,
  vault,
}) => {
  const own = await opened(book, panel, vault);

  await panel.replaceCss("p { A: a; }\nh1 { a: b; }");
  await panel.code.press("ControlOrMeta+F");
  await expect(panel.search).toBeVisible();
  const find = panel.search.getByRole("textbox", { name: "Find" });
  await expect(find).toBeFocused();
  // The panel is set in Obsidian's own measurements.
  await expect(find).toHaveCSS("height", "24px");
  await expect(panel.search).toHaveCSS("padding-top", "8px");

  await find.fill("a");
  await expect(panel.searchMatches).toHaveCount(3);
  const matchCase = panel.search.getByRole("button", { name: "Match case" });
  await matchCase.click();
  await expect(matchCase).toHaveAttribute("aria-pressed", "true");
  await expect(panel.searchMatches).toHaveCount(2);

  const regexp = panel.search.getByRole("button", { name: "Use regular expression" });
  await regexp.click();
  await expect(regexp).toHaveAttribute("aria-pressed", "true");
  await find.fill("[ab];");
  await expect(panel.searchMatches).toHaveCount(2);

  await panel.search.getByRole("textbox", { name: "Replace" }).fill("z;");
  await panel.search.getByRole("button", { name: "Replace all" }).click();
  expect(await panel.cssText()).toBe("p { A: z; }\nh1 { a: z; }");

  await find.press("Escape");
  await expect(panel.search).toHaveCount(0);
  await expect(panel.code).toBeFocused();

  await closed(panel, vault, own);
});

test("Mod-D selects the next copy of the selection, and every other copy of a selected word is highlighted", async ({
  book,
  panel,
  vault,
}) => {
  const own = await opened(book, panel, vault);

  await panel.replaceCss("p { margin: 0; }\nh1 { margin: 1em; }\nh2 { margin: 2em; }");
  await panel.code.press("ControlOrMeta+Home");
  await panel.code.dblclick({ position: await within(panel, 1, 6) });
  await expect(panel.selectionMatches).toHaveCount(2);

  await panel.code.press("ControlOrMeta+D");
  await expect(panel.cursors).toHaveCount(2);
  await panel.code.pressSequentially("padding");
  expect(await panel.cssText()).toBe(
    "p { padding: 0; }\nh1 { padding: 1em; }\nh2 { margin: 2em; }",
  );

  await closed(panel, vault, own);
});

test("Mod-/ wraps the selected lines in a comment and takes it out again", async ({
  book,
  panel,
  vault,
}) => {
  const own = await opened(book, panel, vault);

  await panel.replaceCss("a: b;\nc: d;");
  await panel.code.press("ControlOrMeta+A");
  await panel.code.press("ControlOrMeta+Slash");
  expect(await panel.cssText()).toBe("/* a: b;\nc: d; */");
  await panel.code.press("ControlOrMeta+Slash");
  expect(await panel.cssText()).toBe("a: b;\nc: d;");

  await closed(panel, vault, own);
});

test("Alt-click adds a cursor, and Alt-drag makes a rectangular selection", async ({
  book,
  panel,
  vault,
}) => {
  const own = await opened(book, panel, vault);
  const mouse = panel.code.page().mouse;
  const keyboard = panel.code.page().keyboard;

  await panel.replaceCss("abc\nabc\nabc");
  await panel.code.click({ position: await within(panel, 1, 2) });
  await keyboard.down("Alt");
  const added = await panel.point(3, 2);
  await mouse.click(added.x, added.y);
  await keyboard.up("Alt");
  await expect(panel.cursors).toHaveCount(2);
  await keyboard.type("X");
  expect(await panel.cssText()).toBe("aXbc\nabc\naXbc");

  await panel.replaceCss("abc\nabc\nabc");
  const from = await panel.point(1, 2);
  const to = await panel.point(3, 3);
  await keyboard.down("Alt");
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(to.x, to.y, { steps: 5 });
  await mouse.up();
  await keyboard.up("Alt");
  await expect(panel.cursors).toHaveCount(3);
  await keyboard.type("X");
  expect(await panel.cssText()).toBe("aXc\naXc\naXc");

  await closed(panel, vault, own);
});

/** Opens the fixture book and the CSS view, and answers the book note as it was. */
async function opened(book: Book, panel: Panel, vault: Vault): Promise<string> {
  const own = await vault.read(BOOK);
  vault.touch(BOOK);
  await book.open();
  await book.painted();
  await panel.open();
  await panel.toCss.click();
  await expect(panel.editor).toBeVisible();
  return own;
}

/**
 * Leaves the CSS view, closes the panel and puts the book note back, so
 * neither the edits nor the panel's focus reach the next spec.
 */
async function closed(panel: Panel, vault: Vault, own: string): Promise<void> {
  await panel.toControls.click();
  await panel.close();
  vault.touch(BOOK);
  await vault.modify(BOOK, own);
}

/** A point before a column of a line, from the corner of the editor's text. */
async function within(panel: Panel, line: number, column: number): Promise<{ x: number; y: number }> {
  const point = await panel.point(line, column);
  const box = await panel.code.boundingBox();
  if (box === null) throw new Error("The editor's text is not on the page");
  return { x: point.x - box.x, y: point.y - box.y };
}

// What this suite does not cover: the keys an author presses on a
// keyboard layout other than the runner's, and the Replace and Previous
// buttons one at a time, which call the same commands the tier under
// it holds to.
