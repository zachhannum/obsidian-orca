import assert from "node:assert/strict";
import { test } from "node:test";
import type { MatchedRule } from "fleuron";
import { groupRules, layerOf } from "@/style/layers";

test("each sheet orca sends has a layer, and the engine's own sheet is part of the theme", () => {
  assert.equal(layerOf("book.css"), "own");
  assert.equal(layerOf("design.css"), "design");
  assert.equal(layerOf("orca.css"), "theme");
  assert.equal(layerOf("user-agent.css"), "theme");
  assert.equal(layerOf("elsewhere.css"), undefined);
});

test("matched rules group as your CSS, the design panel and the theme, with the winner first in each", () => {
  // Cascade order, the way the engine reports it: later wins.
  const rules = [
    matched("user-agent.css", "p"),
    matched("orca.css", "book"),
    matched("design.css", "book"),
    matched("orca.css", "p + p"),
    matched("book.css", "p"),
    matched("design.css", "p + p"),
    matched("book.css", "p.lead"),
  ];

  assert.deepEqual(
    groupRules(rules).map(({ layer, rules: each }) => ({
      layer,
      rules: each.map((rule) => `${rule.sheet} ${rule.selector}`),
    })),
    [
      { layer: "own", rules: ["book.css p.lead", "book.css p"] },
      { layer: "design", rules: ["design.css p + p", "design.css book"] },
      {
        layer: "theme",
        rules: ["orca.css p + p", "orca.css book", "user-agent.css p"],
      },
    ],
  );
});

test("a layer with no matched rule is left out", () => {
  const groups = groupRules([matched("user-agent.css", "p"), matched("book.css", "p")]);
  assert.deepEqual(
    groups.map((group) => group.layer),
    ["own", "theme"],
  );
  assert.deepEqual(groupRules([]), []);
});

function matched(sheet: string, selector: string): MatchedRule {
  return {
    sheet,
    line: 1,
    column: 1,
    selector,
    specificity: [0, 0, 1],
    declarations: [],
  };
}

// What this tier does not cover: the rules a real inspection matches,
// which the engine reports and the inspect pane's own tests set.
