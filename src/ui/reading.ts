/**
 * A book's notes as the reader has them. Reading view draws the same
 * chips the editor draws, over the same marks, so a chapter reads the
 * same whichever view it is open in.
 *
 * Obsidian hands over one section of the note at a time, with the
 * lines it was drawn from. The marks are the engine's, and the bytes
 * of the note they name are what places each chip.
 */

import type { MarkdownPostProcessorContext } from "obsidian";
import { byteOf, offsetOf } from "@/book/place";
import { chipElement } from "@/ui/chip";
import type { Marking } from "@/ui/marks";
import type { Drawn } from "@/ui/runs";

/** One section of a note, as Obsidian drew it. */
export interface Section {
  /** The whole note, as the section was drawn from it. */
  text: string;
  /** The first line of the note the section covers, counting from 0. */
  lineStart: number;
  /** The last, counting from 0. */
  lineEnd: number;
}

/**
 * The marks that fall inside a section, with each one's bytes turned
 * into offsets of the section's own text.
 */
export function marksOn(section: Section, marks: readonly Drawn[]): Drawn[] {
  const { from, to } = boundsOf(section);
  return marks.filter((mark) => mark.from >= from && mark.to <= to);
}

/** The bytes of the note a section was drawn from. */
function boundsOf(section: Section): { from: number; to: number } {
  const lines = section.text.split("\n");
  const before = lines.slice(0, section.lineStart).join("\n");
  const opens =
    before.length === 0 && section.lineStart === 0 ? 0 : before.length + 1;
  const through = lines.slice(0, section.lineEnd + 1).join("\n");
  return { from: byteOf(section.text, opens), to: byteOf(section.text, through.length) };
}

/**
 * The lines a setext heading is written on, where the section holds
 * them and not the underline. Obsidian draws those lines as a
 * paragraph of their own, and the heading drawn at the underline says
 * the same words, so the paragraph comes out.
 */
export function repeatedOn(section: Section, marks: readonly Drawn[]): boolean {
  const { from, to } = boundsOf(section);
  return marks.some(
    (mark) =>
      mark.form === "setext" &&
      mark.open !== undefined &&
      mark.open < to &&
      mark.from > from &&
      to < mark.to,
  );
}

/**
 * Draws a section's marks. The chip goes where the run was written,
 * the run's own text comes off, and a setext underline is not drawn
 * at all, because reading view has no line to type on.
 */
export function drawSection(
  element: HTMLElement,
  section: Section,
  marks: readonly Drawn[],
): void {
  if (repeatedOn(section, marks)) {
    element.empty();
    return;
  }
  for (const mark of marksOn(section, marks)) {
    if (mark.form === "setext") {
      redrawSetext(element, section, mark);
      continue;
    }
    if (mark.names === undefined) continue;
    const said = runText(section, mark);
    if (said === undefined) continue;
    replaceRun(element, said, mark);
  }
}

/** The run's own text, as it was written in the note. */
function runText(section: Section, mark: Drawn): string | undefined {
  const from = offsetOf(section.text, mark.from);
  const to = offsetOf(section.text, mark.to);
  return to > from ? section.text.slice(from, to) : undefined;
}

/**
 * Takes a run's text out of the drawn section and puts the chip where
 * it was. The run is cut across every node it falls in, because
 * Obsidian draws an `#id` inside it as a tag of its own. A span run's
 * brackets come out with it, and the words between them stay.
 */
function replaceRun(element: HTMLElement, said: string, mark: Drawn): void {
  const run = said.trim();
  const whole = drawnText(element);
  const at = whole.indexOf(run);
  if (at < 0 || mark.names === undefined) return;
  // A span run closes a bracket, and the bracket comes out with it.
  const opens = mark.form === "span" && whole[at - 1] === "]" ? at - 1 : at;
  takeOut(element, opens, at + run.length, chipElement(mark.names, mark.form));
  if (mark.form !== "span") return;
  // The text taken out and the chip put in both sit after this
  // bracket, so the place it was found at is the place it is still at.
  const bracket = whole.lastIndexOf("[", at);
  if (bracket >= 0) takeOut(element, bracket, bracket + 1, undefined);
}

/** The text an element draws, as one string. */
function drawnText(element: HTMLElement): string {
  return textNodes(element)
    .map((node) => node.nodeValue ?? "")
    .join("");
}

/**
 * Takes the text between two places out of an element, and puts the
 * chip where it was.
 */
function takeOut(
  element: HTMLElement,
  from: number,
  to: number,
  chip: HTMLElement | undefined,
): void {
  // The later place is split first, so the earlier one is still the
  // place it was found at when it is split in turn.
  const tail = splitAt(textNodes(element), to);
  const head = splitAt(textNodes(element), from);
  if (head === undefined) return;
  const nodes = textNodes(element);
  const opens = nodes.indexOf(head);
  if (opens < 0) return;
  const gone: Text[] = [];
  for (const node of nodes.slice(opens)) {
    if (node === tail) break;
    gone.push(node);
  }
  // The chip goes in before the text comes out, so the element that
  // held the run still holds something and does not go with it.
  if (chip !== undefined) place(element, tail, chip);
  for (const node of gone) {
    const above = node.parentNode;
    above?.removeChild(node);
    // The tag Obsidian drew for an `#id` is left with no text, and it
    // goes with the run it was part of.
    if (above !== null && above !== element) prune(above, element);
  }
}

/** Puts the chip where the run was, or at the end where nothing follows it. */
function place(element: HTMLElement, after: Node | undefined, chip: HTMLElement): void {
  if (after?.parentNode == null) element.appendChild(chip);
  else after.parentNode.insertBefore(chip, after);
}

/**
 * Splits the text of an element at a place in the text it draws, and
 * answers with the node the text from there on begins in.
 */
function splitAt(nodes: readonly Text[], at: number): Text | undefined {
  let seen = 0;
  for (const node of nodes) {
    const width = (node.nodeValue ?? "").length;
    if (at <= seen + width) return node.splitText(at - seen);
    seen += width;
  }
  return undefined;
}

/** Takes an emptied element out, and the one around it when that is emptied too. */
function prune(node: Node, stop: HTMLElement): void {
  let at: Node | null = node;
  while (at !== null && at !== stop && (at.textContent ?? "") === "") {
    const above: Node | null = at.parentNode;
    above?.removeChild(at);
    at = above;
  }
}

/**
 * Draws the lines above a setext underline as the heading they make,
 * and takes the underline out. Obsidian draws a heading of more than
 * one line as a paragraph, and the row of dashes under it as a rule.
 */
function redrawSetext(element: HTMLElement, section: Section, mark: Drawn): void {
  const from = offsetOf(section.text, mark.open ?? mark.from);
  const to = offsetOf(section.text, mark.from);
  const said = section.text.slice(from, to).trimEnd();
  if (said === "") return;
  const heading = element.doc.createElement(`h${String(mark.level ?? 2)}`);
  heading.dataset["testid"] = "orca-setext";
  for (const [at, line] of said.split("\n").entries()) {
    if (at > 0) heading.createEl("br");
    heading.appendText(line);
  }
  element.empty();
  element.appendChild(heading);
}

/** Every text node under an element, in the order they are drawn. */
function textNodes(element: HTMLElement): Text[] {
  const found: Text[] = [];
  const walk = element.doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node !== null; node = walk.nextNode()) {
    found.push(node as Text);
  }
  return found;
}

/**
 * The post processor a book's notes are read through. A note no book
 * lists takes no marks, so reading view draws it as Obsidian draws it.
 */
export function readingProcessor(marking: Marking) {
  return async (
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): Promise<void> => {
    const info = context.getSectionInfo(element);
    if (info === null) return;
    // The bytes are counted in the text the section was drawn from, so
    // a parse older than the note draws nothing and Obsidian's own
    // drawing stands.
    const held = marking.marksNow(context.sourcePath, info.text);
    const settled =
      held ??
      (await marking.marksIn(context.sourcePath, info.text).catch(() => undefined));
    if (settled === undefined || settled.marks.length === 0) return;
    drawSection(element, info, settled.marks);
  };
}
