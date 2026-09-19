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
import { chipElement, type Marking } from "@/ui/manuscript";
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
  const lines = section.text.split("\n");
  const before = lines.slice(0, section.lineStart).join("\n");
  const from = byteOf(section.text, before.length === 0 && section.lineStart === 0 ? 0 : before.length + 1);
  const through = lines.slice(0, section.lineEnd + 1).join("\n");
  const to = byteOf(section.text, through.length);
  return marks.filter((mark) => mark.from >= from && mark.to <= to);
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
 * it was. A span run's brackets come off with it.
 */
function replaceRun(element: HTMLElement, said: string, mark: Drawn): void {
  const trimmed = said.trim();
  for (const text of textNodes(element)) {
    const value = text.nodeValue ?? "";
    const at = value.indexOf(trimmed);
    if (at < 0) continue;
    const after = text.splitText(at);
    after.nodeValue = (after.nodeValue ?? "").slice(trimmed.length);
    if (mark.names !== undefined) {
      after.parentNode?.insertBefore(chipElement(mark.names, mark.form), after);
    }
    // A span run's text keeps its place and the brackets come off.
    if (mark.form === "span") unbracket(text);
    return;
  }
}

/** Takes the brackets off the text a span run closes. */
function unbracket(before: Text): void {
  const value = before.nodeValue ?? "";
  const open = value.lastIndexOf("[");
  if (open < 0) return;
  before.nodeValue = value.slice(0, open) + value.slice(open + 1);
}

/**
 * Draws the lines above a setext underline as the heading they make,
 * and takes the underline out. Obsidian draws a heading of more than
 * one line as a paragraph, and a row of dashes as a rule.
 */
function redrawSetext(element: HTMLElement, section: Section, mark: Drawn): void {
  const from = offsetOf(section.text, mark.open ?? mark.from);
  const to = offsetOf(section.text, mark.from);
  const said = section.text.slice(from, to).trimEnd();
  if (said === "") return;
  const level = mark.level ?? 2;
  const heading = element.doc.createElement(`h${String(level)}`);
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
    const settled = await marking
      .marksIn(context.sourcePath, info.text)
      .catch(() => undefined);
    if (settled === undefined || settled.marks.length === 0) return;
    drawSection(element, info, settled.marks);
  };
}
