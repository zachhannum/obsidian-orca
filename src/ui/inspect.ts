/**
 * Inspect mode, as data: what is hovered and pinned, the rectangles the
 * overlay draws, and the rows the pane lists. Orca computes none of the
 * answers. The engine matches the rules and computes the values, and
 * this reads what it returned.
 */

import type {
  Inspection,
  MarginBoxName,
  NodeSource,
  PageBox,
} from "fleuron";
import { roleOf } from "@/book/roles";
import { MARGIN_BOXES } from "@/engine/session";
import { convertLength, type PageUnit } from "@/style/design";

/**
 * A box an author can pick. A node id names a node only until the next
 * edit, and a margin box is named by its page, counting from 0.
 */
export type Target =
  | { kind: "node"; node: number }
  | { kind: "margin"; page: number; box: MarginBoxName };

export interface Pin {
  target: Target;
  /** The bytes of the note the box was read from, which find it again after an edit. */
  anchor?: NodeSource;
  inspection: Inspection;
  /** The generation the inspection answers. */
  generation: number;
}

export interface InspectState {
  on: boolean;
  pin: Pin | undefined;
}

export const INSPECT_OFF: InspectState = { on: false, pin: undefined };

/**
 * The state after one Escape. A pin comes off first, and inspect mode
 * turns off second. With inspect mode off, Escape changes nothing, and
 * the same state comes back.
 */
export function escape(state: InspectState): InspectState {
  if (state.pin !== undefined) return { ...state, pin: undefined };
  if (state.on) return INSPECT_OFF;
  return state;
}

/** The target an inspection answers, for a box found on one page. */
export function targetOf(
  inspection: Inspection,
  page: number,
): Target | undefined {
  if (inspection.node !== null) return { kind: "node", node: inspection.node };
  const box = inspection.element.replace(/^@/, "");
  const named = MARGIN_BOXES.find((name) => name === box);
  return named === undefined ? undefined : { kind: "margin", page, box: named };
}

/**
 * The key the preview writes as `data-hovered` and `data-inspected`: the
 * node id, or `@<box>:<page>` for a margin box with the page counted
 * from 1, as `data-page` counts it.
 */
export function targetKey(target: Target): string {
  return target.kind === "node"
    ? String(target.node)
    : `@${target.box}:${String(target.page + 1)}`;
}

/** A rectangle on a page, in points from its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layers {
  margin: Rect;
  padding: Rect;
  content: Rect;
}

/**
 * The margin, padding and content rectangles around one border box. A
 * negative margin draws as none, and an inset larger than the box
 * leaves an empty rectangle rather than a turned one.
 */
export function layersOf(
  box: PageBox,
  computed: Readonly<Record<string, string>>,
): Layers {
  const side = (property: string): Sides => ({
    top: points(computed[property.replace("*", "top")]),
    right: points(computed[property.replace("*", "right")]),
    bottom: points(computed[property.replace("*", "bottom")]),
    left: points(computed[property.replace("*", "left")]),
  });
  const border: Rect = {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
  const margin = side("margin-*");
  const grown = inset(border, {
    top: -Math.max(margin.top, 0),
    right: -Math.max(margin.right, 0),
    bottom: -Math.max(margin.bottom, 0),
    left: -Math.max(margin.left, 0),
  });
  const padding = inset(border, side("border-*-width"));
  return { margin: grown, padding, content: inset(padding, side("padding-*")) };
}

interface Sides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function inset(rect: Rect, by: Sides): Rect {
  const width = Math.max(rect.width - by.left - by.right, 0);
  const height = Math.max(rect.height - by.top - by.bottom, 0);
  return { x: rect.x + by.left, y: rect.y + by.top, width, height };
}

/** A computed length in points. Anything that is not one, such as `auto`, is 0. */
export function points(value: string | undefined): number {
  const found = /^(-?\d*\.?\d+)(pt)?$/.exec(value?.trim() ?? "");
  return found === null ? 0 : Number(found[1]);
}

/**
 * The side a page cut a fragment open on. The first of a split box is
 * open at the bottom, the last at the top, and one between them at both.
 */
export type Cut = "none" | "top" | "bottom" | "both";

export interface Fragment {
  box: PageBox;
  cut: Cut;
  /** Its place among the engine's boxes. A page can hold two boxes of one element, one per column, so the page does not name a piece. */
  index: number;
}

/**
 * Each of a box's fragments that sits on a painted page, with its cut
 * side. The cut follows the order of every box, painted or not, so the
 * second half of a paragraph is still open at the top when the first
 * half's page is not on screen.
 */
export function fragments(
  boxes: readonly PageBox[],
  shown: Iterable<number>,
): Fragment[] {
  const pages = new Set(shown);
  const last = boxes.length - 1;
  const found: Fragment[] = [];
  boxes.forEach((box, at) => {
    if (!pages.has(box.page)) return;
    const cut: Cut =
      last === 0 ? "none" : at === 0 ? "bottom" : at === last ? "top" : "both";
    found.push({ box, cut, index: at });
  });
  return found;
}

export interface Tag {
  element: string;
  /** The role of the section the box sits in, or the section itself. */
  role: string | undefined;
  /** The box's width and height in the page unit, as `3.54 × 1.04in`. */
  size: string | undefined;
}

/** The words beside the outline. The size is the first fragment's unless one is named. */
export function tagOf(
  inspection: Inspection,
  unit: PageUnit,
  box: PageBox | undefined = inspection.boxes[0],
): Tag {
  return {
    element: leafName(inspection),
    role: roleIn(inspection),
    size: box === undefined ? undefined : sizeOf(box, unit),
  };
}

/** The nearest section's role, read off the classes that name a known one. */
function roleIn(inspection: Inspection): string | undefined {
  const chain = [inspection, ...[...inspection.ancestors].reverse()];
  for (const element of chain) {
    if (element.element !== "section") continue;
    const role = element.classes.find((name) => roleOf(name) !== undefined);
    if (role !== undefined) return role;
  }
  return undefined;
}

/** The decimals each unit is shown to. */
const PLACES: Readonly<Record<PageUnit, number>> = { in: 2, mm: 1, pt: 1 };

/** A box's size, as `3.54 × 1.04in`. */
export function sizeOf(box: PageBox, unit: PageUnit): string {
  const width = lengthIn(box.width, unit);
  const height = lengthIn(box.height, unit);
  return `${width} × ${height}${unit}`;
}

/** A length in points, as a number in the unit with no trailing zeros. */
function lengthIn(value: number, unit: PageUnit): string {
  const converted = convertLength({ value, unit: "pt" }, unit).value;
  return String(Number(converted.toFixed(PLACES[unit])));
}

export interface Row {
  label: string;
  value: string;
}

/**
 * The computed values the pane lists: the font, the line height, the
 * indent, the vertical margins and the box size. Lengths stay in points,
 * as the engine wrote them, but the box, which is in the page unit.
 */
export function computedRows(
  computed: Readonly<Record<string, string>>,
  boxes: readonly PageBox[],
  unit: PageUnit,
): Row[] {
  const rows: Row[] = [];
  const family = firstFamily(computed["font-family"]);
  const size = computed["font-size"];
  const font = [family, size].filter((part) => part !== undefined).join(" ");
  if (font !== "") rows.push({ label: "Font", value: font });
  const leading = computed["line-height"];
  if (leading !== undefined) rows.push({ label: "Line height", value: leading });
  const indent = computed["text-indent"];
  if (indent !== undefined) rows.push({ label: "Indent", value: bare(indent) });
  const above = computed["margin-top"];
  const below = computed["margin-bottom"];
  if (above !== undefined || below !== undefined) {
    rows.push({
      label: "Margins",
      value: `${bare(above ?? "0")} above, ${bare(below ?? "0")} below`,
    });
  }
  const box = boxes[0];
  if (box !== undefined) rows.push({ label: "Box", value: sizeOf(box, unit) });
  return rows;
}

/** The first family of a stack, without its quotes. */
function firstFamily(stack: string | undefined): string | undefined {
  const first = stack?.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first === undefined || first === "" ? undefined : first;
}

/** A zero length, written without its unit. */
function bare(value: string): string {
  return /^-?[0.]+(pt)?$/.test(value.trim()) ? "0" : value;
}

/** The effect a click in inspect mode has on the pin. */
export type Clicked = "pin" | "unpin" | "keep";

/**
 * A click on the pinned box again, or where there is no box, takes the
 * pin off. A click on any other box pins it.
 */
export function clicked(state: InspectState, target: Target | undefined): Clicked {
  if (!state.on) return "keep";
  if (target === undefined) return state.pin === undefined ? "keep" : "unpin";
  if (state.pin !== undefined && targetKey(state.pin.target) === targetKey(target)) {
    return "unpin";
  }
  return "pin";
}

export interface Crumb {
  /** The name a selector reaches it by, as `section#chapter-twelve` or `table.wide`. */
  name: string;
  /** Its classes, faint beside an id. For a section that is its role. */
  faint: string | undefined;
  /** Its place in `ancestors`, for a crumb the author can add to the selector. */
  ancestor: number | undefined;
}

/**
 * The crumbs over the pane, the book first and the box last. A margin
 * box has its page selector before it, which cannot be picked, because
 * a rule for the box is always written inside that page rule.
 */
export function crumbsOf(inspection: Inspection): Crumb[] {
  if (inspection.node === null && inspection.page !== undefined) {
    return [
      { name: inspection.page, faint: undefined, ancestor: undefined },
      { name: inspection.element, faint: undefined, ancestor: undefined },
    ];
  }
  const chain = inspection.ancestors.map((element, at) => ({
    name: nameOf(element),
    faint: faintOf(element),
    ancestor: at,
  }));
  const leaf: Crumb[] = [
    { name: nameOf(inspection), faint: faintOf(inspection), ancestor: undefined },
  ];
  if (inspection.pseudoElement !== undefined) {
    leaf.push({ name: inspection.pseudoElement, faint: undefined, ancestor: undefined });
  }
  return [...chain, ...leaf];
}

/**
 * An element by its id where it has one, and by its classes where it
 * does not. A section always has an id, so it never goes by its place
 * in the book.
 */
function nameOf(element: {
  element: string;
  id: string | null;
  classes: readonly string[];
}): string {
  if (hasId(element)) return `${element.element}#${element.id ?? ""}`;
  return `${element.element}${element.classes.map((name) => `.${name}`).join("")}`;
}

/**
 * The end of the selector the pane names: the element, and the
 * pseudo-element after it where the box is one.
 */
function leafName(inspection: Inspection): string {
  return `${nameOf(inspection)}${inspection.pseudoElement ?? ""}`;
}

function faintOf(element: { id: string | null; classes: readonly string[] }): string | undefined {
  return hasId(element) && element.classes.length > 0 ? element.classes.join(" ") : undefined;
}

function hasId(element: { id: string | null }): boolean {
  return element.id !== null && element.id !== "";
}

/**
 * The selector for the box with the ancestors the author picked, as
 * `section#chapter-twelve > p`. A picked ancestor that is the parent of
 * the next part is joined with `>`, and any other with a space. A
 * margin box is named by its at-rule alone.
 */
export function selectorFor(
  inspection: Inspection,
  picked: Iterable<number>,
): string {
  if (inspection.node === null && inspection.page !== undefined) {
    return inspection.element;
  }
  const last = inspection.ancestors.length;
  const chosen = [...new Set(picked)]
    .filter((at) => Number.isInteger(at) && at >= 0 && at < last)
    .sort((a, b) => a - b);
  let selector = "";
  chosen.forEach((at, index) => {
    const ancestor = inspection.ancestors[at];
    if (ancestor === undefined) return;
    const next = chosen[index + 1] ?? last;
    selector += `${nameOf(ancestor)}${next === at + 1 ? " > " : " "}`;
  });
  return `${selector}${leafName(inspection)}`;
}

/**
 * The ancestors a selector starts with: each one up to the nearest
 * ancestor with an id, since no other element shares an id. The book is
 * never one of them. A box with its own id, or a margin box, needs none.
 */
export function specificPicks(inspection: Inspection): number[] {
  if (inspection.node === null && inspection.page !== undefined) return [];
  if (hasId(inspection)) return [];
  const picks: number[] = [];
  for (let at = inspection.ancestors.length - 1; at >= 0; at -= 1) {
    const ancestor = inspection.ancestors[at];
    if (ancestor === undefined || ancestor.element === "book") break;
    picks.unshift(at);
    if (hasId(ancestor)) break;
  }
  return picks;
}

/**
 * The empty rule "Add a rule" writes. A margin box's rule sits inside
 * its page rule, as `@page :left { @top-left { } }`. The caret goes on
 * the empty line inside the innermost braces, which `inserted` finds.
 */
export function ruleFor(inspection: Inspection, picked: Iterable<number>): string {
  const selector = selectorFor(inspection, picked);
  if (inspection.node === null && inspection.page !== undefined) {
    return `${inspection.page} {\n  ${selector} {\n    \n  }\n}`;
  }
  return `${selector} {\n  \n}`;
}

/**
 * The key the pane keeps its picked crumbs under. A refreshed pin with
 * the same key is the same box, so the crumbs stay; any other starts
 * with none picked.
 */
export function boxKey(pin: Pin): string {
  const { inspection } = pin;
  const chain = [...inspection.ancestors.map(nameOf), leafName(inspection)].join(" ");
  return `${targetKey(pin.target)} ${chain}`;
}

/**
 * Whether two inspections answer for the same box: the same element,
 * and the same pseudo-element of it. A paragraph and its drop cap are
 * not the same box, and both name `p`.
 */
export function sameBox(found: Inspection, pinned: Inspection): boolean {
  return (
    found.element === pinned.element &&
    found.pseudoElement === pinned.pseudoElement
  );
}

/**
 * Whether the node found at the anchor's first byte is the pinned box:
 * read from the same note and starting at the same byte.
 */
export function stillPinned(
  anchor: NodeSource,
  found: NodeSource | undefined,
): boolean {
  return (
    found !== undefined &&
    found.source === anchor.source &&
    found.start === anchor.start
  );
}

/**
 * The anchor carried through one edit of its note, from the text before
 * to the text after. The edit is the span between the longest shared
 * start and end. An edit wholly before the anchor shifts it, one inside
 * it moves its end, and one that takes its first byte removes it, which
 * comes back as nothing.
 */
export function mapAnchor(
  anchor: NodeSource,
  before: string,
  after: string,
): NodeSource | undefined {
  if (before === after) return anchor;
  const was = new TextEncoder().encode(before);
  const now = new TextEncoder().encode(after);
  let head = 0;
  const shortest = Math.min(was.length, now.length);
  while (head < shortest && was[head] === now[head]) head += 1;
  let tail = 0;
  while (
    tail < shortest - head &&
    was[was.length - 1 - tail] === now[now.length - 1 - tail]
  ) {
    tail += 1;
  }
  const cutEnd = was.length - tail;
  const delta = now.length - was.length;
  if (anchor.end <= head) return anchor;
  if (anchor.start >= cutEnd) {
    return { ...anchor, start: anchor.start + delta, end: anchor.end + delta };
  }
  if (anchor.start < head) {
    return { ...anchor, end: Math.max(anchor.end + delta, head) };
  }
  return undefined;
}

/**
 * Converts a point on a painted page from the page element's box, in
 * pixels, to points from the page's top-left corner. Nothing for a
 * point off the page.
 */
export function pointOn(
  rect: { left: number; top: number; width: number; height: number },
  trim: { width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } | undefined {
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const across = (clientX - rect.left) / rect.width;
  const down = (clientY - rect.top) / rect.height;
  if (across < 0 || across > 1 || down < 0 || down > 1) return undefined;
  return { x: across * trim.width, y: down * trim.height };
}
