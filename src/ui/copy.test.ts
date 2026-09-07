import assert from "node:assert/strict";
import { test } from "node:test";
import {
  copiedText,
  type Selected,
  type SelectionLine,
  type SelectionNode,
} from "@/ui/copy";

/** One line of the painter's layer, with the text node under it. */
function line(text: string): SelectionLine {
  const child: SelectionNode = { textContent: text };
  return {
    textContent: text,
    firstChild: child,
    contains: (node) => node === child || node === null,
  };
}

/** A drag from one line's character to another's. */
function drag(
  lines: SelectionLine[],
  from: { line: number; at: number },
  to: { line: number; at: number },
): Selected {
  const start = lines[from.line]?.firstChild;
  const end = lines[to.line]?.firstChild;
  assert.ok(start && end, "the drag landed off the lines");
  return {
    startContainer: start,
    startOffset: from.at,
    endContainer: end,
    endOffset: to.at,
    intersectsNode: (node) => {
      const at = lines.indexOf(node);
      return at >= from.line && at <= to.line;
    },
  };
}

test("copy off a page returns the lines it covers, in reading order", () => {
  const lines = [
    line("In consequence of an agreement between the"),
    line("sisters, Elizabeth wrote the next morning to"),
    line("their mother, to beg that the carriage might"),
  ];

  const text = copiedText(lines, drag(lines, { line: 0, at: 3 }, { line: 2, at: 12 }));

  // Each line is sliced at the drag's own boundaries, and the lines are
  // joined in the order they are set rather than run together.
  assert.equal(
    text,
    "consequence of an agreement between the\n" +
      "sisters, Elizabeth wrote the next morning to\n" +
      "their mother",
  );
});

test("a drag inside one line copies that line alone", () => {
  const lines = [line("In consequence of an agreement"), line("between the")];

  assert.equal(
    copiedText(lines, drag(lines, { line: 0, at: 3 }, { line: 0, at: 14 })),
    "consequence",
  );
});

test("a boundary on the line itself is one end of it, not a stray zero", () => {
  const lines = [line("Elizabeth"), line("took leave")];
  const range: Selected = {
    startContainer: lines[0] as SelectionNode,
    startOffset: 0,
    endContainer: lines[1] as SelectionNode,
    endOffset: 1,
    intersectsNode: () => true,
  };

  assert.equal(copiedText(lines, range), "Elizabeth\ntook leave");
});

test("a drag that touches no line copies nothing, so the page answers for nothing else", () => {
  const lines = [line("Elizabeth")];
  const range: Selected = {
    startContainer: { textContent: "elsewhere" },
    startOffset: 0,
    endContainer: { textContent: "elsewhere" },
    endOffset: 3,
    intersectsNode: () => false,
  };

  assert.equal(copiedText(lines, range), undefined);
});

// What this tier does not cover: the browser's own selection over the
// painted glyphs, which the e2e job drags and reads back off the
// clipboard.
