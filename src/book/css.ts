/**
 * The book's own CSS is the first `css` fence in the note's body. The
 * fence is lines the reading order keeps as written, so replacing what
 * is inside it leaves every other line of the note as it was.
 */

import { writeOrder, type Block, type Order } from "@/book/order";

const OPEN = /^\s*```css\s*$/;
const CLOSE = /^\s*```\s*$/;

/** The lines of the fence: its opening line, and one past its last line. */
interface Fence {
  open: number;
  /** One past the last line of CSS, which is the closing line when there is one. */
  close: number;
}

/** The book's own CSS as the fence holds it, or nothing when the note has no fence. */
export function bookCss(order: Order): string {
  const fence = fenceOf(order.blocks);
  if (fence === undefined) return "";
  return writeOrder({ blocks: order.blocks.slice(fence.open + 1, fence.close) });
}

/**
 * The order with this CSS inside the fence. A note with no fence gets
 * one at the end of its body, and CSS that is empty adds none.
 */
export function withCss(order: Order, css: string): Order {
  // An empty fence and a fence of one blank line both read as no CSS,
  // so CSS that has not changed leaves the fence as it is written.
  if (bookCss(order) === css) return order;
  const lines = css.split("\n").map((line): Block => ({ kind: "other", line }));
  const fence = fenceOf(order.blocks);
  if (fence !== undefined) {
    const blocks = [...order.blocks];
    // A fence the author never closed runs to the end of the note, and
    // the write closes it.
    const closed = fence.close < blocks.length;
    blocks.splice(
      fence.open + 1,
      fence.close - fence.open - 1,
      ...lines,
      ...(closed ? [] : [{ kind: "other" as const, line: "```" }]),
    );
    return { blocks };
  }
  if (css === "") return order;

  const blocks = [...order.blocks];
  // The body ends on a blank line, which gives the note its last newline.
  const last = blocks.at(-1);
  const ended = last?.kind === "other" && last.line === "";
  if (ended) blocks.pop();
  if (blocks.length > 0) blocks.push({ kind: "other", line: "" });
  blocks.push(
    { kind: "other", line: "```css" },
    ...lines,
    { kind: "other", line: "```" },
    { kind: "other", line: "" },
  );
  return { blocks };
}

function fenceOf(blocks: readonly Block[]): Fence | undefined {
  const open = blocks.findIndex(
    (block) => block.kind === "other" && OPEN.test(block.line),
  );
  if (open < 0) return undefined;
  let close = open + 1;
  while (close < blocks.length) {
    const block = blocks[close];
    if (block?.kind === "other" && CLOSE.test(block.line)) break;
    close += 1;
  }
  return { open, close };
}
