import assert from "node:assert/strict";
import { test } from "node:test";
import { showPage, type Surface } from "@/ui/page";

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

  showPage(node, { markup: '<svg data-page="1"></svg>', generation: 1, stages });
  showPage(node, { markup: '<svg data-page="2"></svg>', generation: 2, stages });

  assert.deepEqual(node.writes, [
    '<svg data-page="1"></svg>',
    '<svg data-page="2"></svg>',
  ]);
});

test("the surface carries the generation painted into it, and what that cost", () => {
  const node = surface();

  showPage(node, {
    markup: "<svg></svg>",
    generation: 7,
    stages: { style: 1, lines: 4, flow: 3, paint: 2 },
  });

  assert.equal(node.dataset["generation"], "7");
  assert.equal(node.dataset["stageStyle"], "1");
  assert.equal(node.dataset["stageLines"], "4");
  assert.equal(node.dataset["stageFlow"], "3");
  assert.equal(node.dataset["stagePaint"], "2");
});

// What this tier does not cover: the surface inside a leaf, which the
// e2e job paints and photographs.
