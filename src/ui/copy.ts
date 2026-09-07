/**
 * A page is paths, and the text over it is the painter's selection
 * layer: one transparent line per line set, in reading order. A
 * browser puts no line break between two SVG `<text>` siblings the way
 * it would between paragraphs, so what copy yields is rebuilt from the
 * lines the selection touches rather than left to the default.
 */

/** A node a selection boundary can land on. */
export interface SelectionNode {
  readonly textContent: string | null;
}

/** One line of the painter's selection layer. */
export interface SelectionLine extends SelectionNode {
  readonly firstChild: SelectionNode | null;
  contains(node: SelectionNode | null): boolean;
}

/** The part of a selection a copy reads. */
export interface Selected {
  readonly startContainer: SelectionNode;
  readonly startOffset: number;
  readonly endContainer: SelectionNode;
  readonly endOffset: number;
  intersectsNode(node: SelectionLine): boolean;
}

/**
 * The lines a selection covers, each sliced at its own boundaries and
 * joined in reading order. Nothing for a selection that touches no
 * line, which is a drag that landed outside the pages.
 */
export function copiedText(
  lines: readonly SelectionLine[],
  range: Selected,
): string | undefined {
  const parts: string[] = [];
  for (const line of lines) {
    if (!range.intersectsNode(line)) continue;
    const full = line.textContent ?? "";
    const from = line.contains(range.startContainer)
      ? boundary(line, range.startContainer, range.startOffset)
      : 0;
    const to = line.contains(range.endContainer)
      ? boundary(line, range.endContainer, range.endOffset)
      : full.length;
    parts.push(full.slice(from, to));
  }
  return parts.length === 0 ? undefined : parts.join("\n");
}

/**
 * A boundary's offset into a line's own text, whichever node it landed
 * on. Inside the line's text node the offset is already a character
 * index; on the line itself, which has that one child, it is a child
 * index, so it becomes one end of the line rather than a stray zero.
 */
function boundary(
  line: SelectionLine,
  container: SelectionNode,
  offset: number,
): number {
  if (container === line.firstChild) return offset;
  return offset === 0 ? 0 : (line.textContent ?? "").length;
}
