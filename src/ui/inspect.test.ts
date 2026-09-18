import assert from "node:assert/strict";
import { test } from "node:test";
import type { Inspection, NodeSource, PageBox } from "fleuron";
import {
  INSPECT_OFF,
  boxKey,
  clicked,
  computedRows,
  crumbsOf,
  escape,
  fragments,
  layersOf,
  mapAnchor,
  pointOn,
  ruleFor,
  sameBox,
  selectorFor,
  specificPicks,
  stillPinned,
  tagOf,
  targetKey,
  targetOf,
  type Pin,
} from "@/ui/inspect";

function inspection(over: Partial<Inspection> = {}): Inspection {
  return {
    node: 12,
    element: "p",
    elementNode: 12,
    id: null,
    classes: [],
    ancestors: [
      { node: null, element: "book", id: null, classes: [] },
      { node: 3, element: "section", id: "the-harbor", classes: ["chapter"] },
    ],
    rules: [],
    computed: {},
    boxes: [{ page: 4, x: 72, y: 90, width: 255, height: 75 }],
    ...over,
  };
}

const pin: Pin = {
  target: { kind: "node", node: 12 },
  inspection: inspection(),
  generation: 3,
};

test("the first Escape removes the pin and the second turns inspect mode off", () => {
  const pinned = { on: true, pin };
  const first = escape(pinned);
  assert.deepEqual(first, { on: true, pin: undefined });
  const second = escape(first);
  assert.deepEqual(second, INSPECT_OFF);
  // With inspect mode off, the key is not the overlay's to take.
  assert.equal(escape(second), second);
});

test("a click on the pinned box again, or where no box is, takes the pin off", () => {
  const pinned = { on: true, pin };
  assert.equal(clicked(pinned, { kind: "node", node: 12 }), "unpin");
  assert.equal(clicked(pinned, undefined), "unpin");
  assert.equal(clicked(pinned, { kind: "node", node: 13 }), "pin");
  assert.equal(clicked({ on: true, pin: undefined }, { kind: "node", node: 12 }), "pin");
  assert.equal(clicked({ on: true, pin: undefined }, undefined), "keep");
  assert.equal(clicked(INSPECT_OFF, { kind: "node", node: 12 }), "keep");
});

test("a margin, padding and content rectangle come from the computed lengths", () => {
  const box: PageBox = { page: 0, x: 100, y: 200, width: 60, height: 40 };
  const layers = layersOf(box, {
    "margin-top": "10pt",
    "margin-right": "0",
    "margin-bottom": "-4pt",
    "margin-left": "5pt",
    "border-top-width": "1pt",
    "border-right-width": "1pt",
    "border-bottom-width": "1pt",
    "border-left-width": "1pt",
    "padding-top": "2pt",
    "padding-right": "auto",
    "padding-bottom": "2pt",
    "padding-left": "3pt",
  });
  assert.deepEqual(layers.margin, { x: 95, y: 190, width: 65, height: 50 });
  assert.deepEqual(layers.padding, { x: 101, y: 201, width: 58, height: 38 });
  assert.deepEqual(layers.content, { x: 104, y: 203, width: 55, height: 34 });
});

test("an inset larger than the box leaves an empty rectangle", () => {
  const box: PageBox = { page: 0, x: 0, y: 0, width: 4, height: 4 };
  const { content } = layersOf(box, { "padding-left": "10pt" });
  assert.equal(content.width, 0);
});

test("a box split across pages is drawn on each painted page, open on the cut side", () => {
  const boxes: PageBox[] = [
    { page: 3, x: 0, y: 500, width: 10, height: 40 },
    { page: 4, x: 0, y: 0, width: 10, height: 600 },
    { page: 5, x: 0, y: 0, width: 10, height: 20 },
  ];
  assert.deepEqual(
    fragments(boxes, [3, 4, 5]).map((fragment) => fragment.cut),
    ["bottom", "both", "top"],
  );
  // A page not painted draws nothing, and the cut still counts it.
  assert.deepEqual(fragments(boxes, new Set([5])), [
    { box: boxes[2], cut: "top", index: 2 },
  ]);
  assert.deepEqual(
    fragments(boxes.slice(0, 1), [3]).map((fragment) => fragment.cut),
    ["none"],
  );
});

test("two boxes of one element on the same page are two pieces, each named apart", () => {
  // A section the engine sets in two places on one page answers with a
  // box for each. The overlay keys a piece by its index, so a page does
  // not name two pieces the same and a stale piece is not left behind.
  const boxes: PageBox[] = [
    { page: 3, x: 0, y: 40, width: 10, height: 200 },
    { page: 4, x: 0, y: 0, width: 10, height: 300 },
    { page: 4, x: 0, y: 340, width: 10, height: 200 },
    { page: 5, x: 0, y: 0, width: 10, height: 20 },
  ];
  const pieces = fragments(boxes, [4]);
  assert.deepEqual(
    pieces.map(({ box, index }) => [box.page, index]),
    [
      [4, 1],
      [4, 2],
    ],
  );
  assert.equal(new Set(fragments(boxes, [3, 4, 5]).map(({ index }) => index)).size, boxes.length);
});

test("the tag names the element, the section's role and the size in the page unit", () => {
  assert.deepEqual(tagOf(inspection(), "in"), {
    element: "p",
    role: "chapter",
    size: "3.54 × 1.04in",
  });
  assert.equal(tagOf(inspection(), "pt").size, "255 × 75pt");
  assert.equal(tagOf(inspection(), "mm").size, "90 × 26.5mm");
});

test("a section's own tag takes its role, and a class that is no role is passed over", () => {
  const section = inspection({
    element: "section",
    classes: ["drop", "title-page"],
    ancestors: [{ node: null, element: "book", id: null, classes: [] }],
  });
  assert.equal(tagOf(section, "in").role, "title-page");
  const loose = inspection({
    ancestors: [{ node: 2, element: "section", id: null, classes: ["drop"] }],
  });
  assert.equal(tagOf(loose, "in").role, undefined);
});

test("a margin box is a target by its page and name", () => {
  const head = inspection({ node: null, element: "@top-center", boxes: [] });
  const target = targetOf(head, 6);
  assert.deepEqual(target, { kind: "margin", page: 6, box: "top-center" });
  assert.equal(target && targetKey(target), "@top-center:7");
  assert.equal(targetKey({ kind: "node", node: 41 }), "41");
  assert.equal(targetOf(inspection({ node: null, element: "@nowhere" }), 0), undefined);
});

test("the computed rows list the font, line height, indent, margins and box", () => {
  const rows = computedRows(
    {
      "font-family": '"Alegreya", serif',
      "font-size": "10.5pt",
      "line-height": "14pt",
      "text-indent": "14.2pt",
      "margin-top": "0pt",
      "margin-bottom": "6pt",
    },
    inspection().boxes,
    "in",
  );
  assert.deepEqual(rows, [
    { label: "Font", value: "Alegreya 10.5pt" },
    { label: "Line height", value: "14pt" },
    { label: "Indent", value: "14.2pt" },
    { label: "Margins", value: "0 above, 6pt below" },
    { label: "Box", value: "3.54 × 1.04in" },
  ]);
  assert.deepEqual(computedRows({}, [], "in"), []);
});

test("a pin holds while the node at its anchor starts where the anchor does", () => {
  const anchor: NodeSource = { source: "Harbor.md", start: 40, end: 90 };
  assert.equal(stillPinned(anchor, { source: "Harbor.md", start: 40, end: 120 }), true);
  assert.equal(stillPinned(anchor, { source: "Harbor.md", start: 38, end: 90 }), false);
  assert.equal(stillPinned(anchor, { source: "Other.md", start: 40, end: 90 }), false);
  assert.equal(stillPinned(anchor, undefined), false);
});

test("typing above the pinned box shifts its anchor, and removing it takes the anchor", () => {
  const before = "# One\n\nFirst para.\n\nPinned para.\n";
  const anchor: NodeSource = {
    source: "n.md",
    start: before.indexOf("Pinned"),
    end: before.indexOf("Pinned") + "Pinned para.".length,
  };
  const typed = before.replace("First", "First long");
  assert.deepEqual(mapAnchor(anchor, before, typed), {
    ...anchor,
    start: anchor.start + 5,
    end: anchor.end + 5,
  });
  // Typing below the box leaves it where it is.
  assert.equal(mapAnchor(anchor, before, `${before}More.\n`), anchor);
  // Typing inside it moves its end only.
  const inside = before.replace("Pinned para", "Pinned long para");
  assert.deepEqual(mapAnchor(anchor, before, inside), { ...anchor, end: anchor.end + 5 });
  const removed = before.replace("Pinned para.\n", "");
  assert.equal(mapAnchor(anchor, before, removed), undefined);
  // Bytes, not characters: a curly quote above is three of them.
  const quoted = before.replace("First", "“First”");
  assert.equal(mapAnchor(anchor, before, quoted)?.start, anchor.start + 6);
});

test("a point on a page element converts to points from the page's corner", () => {
  const rect = { left: 100, top: 50, width: 300, height: 450 };
  const trim = { width: 432, height: 648 };
  assert.deepEqual(pointOn(rect, trim, 250, 275), { x: 216, y: 324 });
  assert.equal(pointOn(rect, trim, 99, 60), undefined);
});

test("a crumb names a section by its id with its class faint, and the box comes last", () => {
  const found = inspection();
  assert.deepEqual(crumbsOf(found), [
    { name: "book", faint: undefined, ancestor: 0 },
    { name: "section#the-harbor", faint: "chapter", ancestor: 1 },
    { name: "p", faint: undefined, ancestor: undefined },
  ]);
  const head = inspection({
    node: null,
    elementNode: null,
    element: "@top-left",
    ancestors: [],
    page: "@page :left",
  });
  assert.deepEqual(
    crumbsOf(head).map(({ name, ancestor }) => [name, ancestor]),
    [
      ["@page :left", undefined],
      ["@top-left", undefined],
    ],
  );
});

test("a picked crumb joins the selector, by `>` for a parent and a space for any other", () => {
  const found = inspection();
  assert.equal(selectorFor(found, []), "p");
  assert.equal(selectorFor(found, [1]), "section#the-harbor > p");
  assert.equal(selectorFor(found, [0]), "book p");
  assert.equal(selectorFor(found, [1, 0]), "book > section#the-harbor > p");
  // A place past the chain is not a crumb.
  assert.equal(selectorFor(found, [7]), "p");
  // A section pinned itself is named by its id, never by its place.
  const section = inspection({
    element: "section",
    id: "chapter-twelve",
    classes: ["chapter"],
    ancestors: [{ node: null, element: "book", id: null, classes: [] }],
  });
  assert.equal(selectorFor(section, []), "section#chapter-twelve");
});

test("the selector starts at the nearest ancestor with an id, naming each element by its id or classes", () => {
  const book = { node: null, element: "book", id: null, classes: [] };
  const cell = inspection({
    ancestors: [
      book,
      { node: 3, element: "section", id: "chapter-twelve", classes: ["chapter"] },
      { node: 5, element: "table", id: null, classes: ["wide"] },
      { node: 6, element: "thead", id: null, classes: [] },
      { node: 7, element: "tr", id: null, classes: [] },
      { node: 8, element: "th", id: null, classes: [] },
    ],
  });
  assert.deepEqual(specificPicks(cell), [1, 2, 3, 4, 5]);
  assert.equal(
    selectorFor(cell, specificPicks(cell)),
    "section#chapter-twelve > table.wide > thead > tr > th > p",
  );
  // A class-only crumb carries its classes in its name, not faint.
  assert.deepEqual(crumbsOf(cell)[2], { name: "table.wide", faint: undefined, ancestor: 2 });
  // Nothing above the box has an id, so the selector stops below the book.
  const loose = inspection({
    ancestors: [book, { node: 4, element: "div", id: null, classes: ["note"] }],
  });
  assert.equal(selectorFor(loose, specificPicks(loose)), "div.note > p");
  // A box with its own id needs no ancestor, and neither does a margin box.
  assert.deepEqual(specificPicks(inspection({ id: "epigraph", classes: ["quiet"] })), []);
  assert.equal(selectorFor(inspection({ id: "epigraph", classes: ["quiet"] }), []), "p#epigraph");
  const head = inspection({ node: null, element: "@top-left", ancestors: [], page: "@page :left" });
  assert.deepEqual(specificPicks(head), []);
});

test("an added rule is empty, and a margin box's sits inside its page rule", () => {
  assert.equal(ruleFor(inspection(), [1]), "section#the-harbor > p {\n  \n}");
  const head = inspection({ node: null, element: "@top-left", ancestors: [], page: "@page :left" });
  assert.equal(selectorFor(head, [0]), "@top-left");
  assert.equal(ruleFor(head, []), "@page :left {\n  @top-left {\n    \n  }\n}");
});

test("the tag and the crumbs name a pseudo-element after its element", () => {
  const cap = inspection({ node: 2147483690, pseudoElement: "::first-letter" });
  assert.equal(tagOf(cap, "in").element, "p::first-letter");
  assert.deepEqual(crumbsOf(cap), [
    { name: "book", faint: undefined, ancestor: 0 },
    { name: "section#the-harbor", faint: "chapter", ancestor: 1 },
    { name: "p", faint: undefined, ancestor: undefined, pins: 12 },
    { name: "::first-letter", faint: undefined, ancestor: undefined },
  ]);
});

test("the crumb for the element a pseudo-element belongs to pins that element", () => {
  const cap = inspection({ node: 2147483690, pseudoElement: "::before" });
  const crumbs = crumbsOf(cap);
  assert.equal(crumbs.at(-2)?.pins, 12);
  assert.equal(crumbs.filter((crumb) => crumb.pins !== undefined).length, 1);
  // The element the pane already answers for pins nothing, and neither
  // does a pseudo-element whose element the engine did not name.
  assert.equal(crumbsOf(inspection()).at(-1)?.pins, undefined);
  const loose = inspection({ node: 2147483690, elementNode: null, pseudoElement: "::before" });
  assert.equal(crumbsOf(loose).at(-2)?.pins, undefined);
});

test("an added rule for a pseudo-element has a selector that ends with it", () => {
  const cap = inspection({ node: 2147483690, pseudoElement: "::first-letter" });
  assert.equal(selectorFor(cap, []), "p::first-letter");
  assert.equal(
    ruleFor(cap, specificPicks(cap)),
    "section#the-harbor > p::first-letter {\n  \n}",
  );
  // The element's own id still ends the chain, with the pseudo-element after it.
  const before = inspection({ id: "epigraph", pseudoElement: "::before" });
  assert.equal(ruleFor(before, specificPicks(before)), "p#epigraph::before {\n  \n}");
});

test("a pseudo-element and the element it belongs to are not the same box", () => {
  const paragraph = inspection();
  const cap = inspection({ node: 2147483690, pseudoElement: "::first-letter" });
  assert.equal(sameBox(cap, cap), true);
  assert.equal(sameBox(paragraph, cap), false);
  assert.equal(sameBox(cap, inspection({ pseudoElement: "::first-line" })), false);
  assert.notEqual(boxKey({ ...pin, target: { kind: "node", node: 2147483690 }, inspection: cap }), boxKey(pin));
});

test("a refreshed pin on the same box keeps its key, and another box does not", () => {
  const again: Pin = { ...pin, generation: 4, inspection: inspection({ rules: [] }) };
  assert.equal(boxKey(again), boxKey(pin));
  const other: Pin = { ...pin, target: { kind: "node", node: 13 } };
  assert.notEqual(boxKey(other), boxKey(pin));
});

// A pinned pseudo-element has no anchor, because no source holds one.
// It is found again by its id alone, and the pin comes off when the
// engine no longer answers for it. That path runs in the e2e specs.
//
// What this tier does not cover: the overlay in a painted preview, the
// pointer turning into a hit on the engine, and a pin found again after
// a real edit, which wait on the e2e specs. mapAnchor reads one edit as
// one span, so two edits far apart that land in one render take a pin
// that sits between them. A pin on matter the engine wrote itself has
// no anchor, and after an edit it holds only while the same node id
// still names the same element; this tier does not check that either.
