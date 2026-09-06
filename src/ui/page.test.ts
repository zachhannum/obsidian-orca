import assert from "node:assert/strict";
import { test } from "node:test";
import { showPage, turnedTo, type Surface } from "@/ui/page";

function surface(): Surface & { readonly writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    dataset: {},
    get innerHTML(): string {
      return writes.at(-1) ?? "";
    },
    set innerHTML(markup: string) {
      writes.push(markup);
    },
  };
}

test("a page is the painter's markup in one write, not a node at a time", () => {
  const node = surface();
  const stages = { style: 1, lines: 1, flow: 1, paint: 1 };

  const place = { page: 1, pages: 337 };

  showPage(node, {
    markup: '<svg data-page="1"></svg>',
    generation: 1,
    stages,
    ...place,
  });
  showPage(node, {
    markup: '<svg data-page="2"></svg>',
    generation: 2,
    stages,
    ...place,
  });

  assert.deepEqual(node.writes, [
    '<svg data-page="1"></svg>',
    '<svg data-page="2"></svg>',
  ]);
});

test("the surface has the generation painted into it, what that cost, and where in the book it is", () => {
  const node = surface();

  showPage(node, {
    markup: "<svg></svg>",
    generation: 7,
    stages: { style: 1, lines: 4, flow: 3, paint: 2 },
    page: 12,
    pages: 337,
  });

  assert.equal(node.dataset["generation"], "7");
  assert.equal(node.dataset["stageStyle"], "1");
  assert.equal(node.dataset["stageLines"], "4");
  assert.equal(node.dataset["stageFlow"], "3");
  assert.equal(node.dataset["stagePaint"], "2");
  assert.equal(node.dataset["page"], "12");
  assert.equal(node.dataset["pages"], "337");
});

test("page up, page down, home and end turn to the page each one names", () => {
  assert.equal(turnedTo("PageDown", 11, 337), 12);
  assert.equal(turnedTo("PageUp", 11, 337), 10);
  assert.equal(turnedTo("Home", 11, 337), 0);
  assert.equal(turnedTo("End", 11, 337), 336);
  // Off either end is the session's to hold inside the book.
  assert.equal(turnedTo("PageUp", 0, 337), -1);
  assert.equal(turnedTo("PageDown", 336, 337), 337);
  assert.equal(turnedTo("ArrowDown", 11, 337), undefined);
});

// What this tier does not cover: the surface inside a leaf, which the
// e2e job paints and photographs.
