import assert from "node:assert/strict";
import { test } from "node:test";
import type { Inspection, NodeSource, PageBox } from "fleuron";
import {
  INSPECT_OFF,
  computedRows,
  escape,
  fragments,
  layersOf,
  mapAnchor,
  pointOn,
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
    { box: boxes[2], cut: "top" },
  ]);
  assert.deepEqual(
    fragments(boxes.slice(0, 1), [3]).map((fragment) => fragment.cut),
    ["none"],
  );
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

// What this tier does not cover: the overlay in a painted preview, the
// pointer turning into a hit on the engine, and a pin found again after
// a real edit, which wait on the e2e specs. mapAnchor reads one edit as
// one span, so two edits far apart that land in one render take a pin
// that sits between them. A pin on matter the engine wrote itself has
// no anchor, and after an edit it holds only while the same node id
// still names the same element; this tier does not check that either.
