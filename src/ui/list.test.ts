import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collapse,
  flatten,
  groupId,
  moveRow,
  moveSection,
  places,
  type Item,
} from "@/ui/list";
import type { Grouped } from "@/ui/shelf";

/** A book of three sections, as the navigator lists it. */
function shelf(): Grouped[] {
  const rows = (...names: string[]): Grouped["rows"] =>
    names.map((name) => ({
      at: 0,
      name,
      kind: "note" as const,
      role: "chapter" as const,
      named: false,
    }));
  return [
    { heading: "Front matter", rows: rows("Copyright", "Contents") },
    { heading: "Body", rows: rows("One", "Two", "Three") },
    { heading: "Back matter", rows: rows("Thanks") },
  ];
}

/** What the list reads as, top to bottom. */
function shown(items: Item[]): string[] {
  return items.map((item) =>
    item.kind === "group" ? `# ${item.heading}` : item.row.name,
  );
}

/** The entry a row is dragged by. */
function id(items: Item[], name: string): string {
  const found = items.find((item) => item.kind === "row" && item.row.name === name);
  if (found === undefined) throw new Error(`no row called ${name}`);
  return found.id;
}

test("the groups flatten to one list, and every row is numbered by its place", () => {
  const items = flatten(shelf());

  assert.deepEqual(shown(items), [
    "# Front matter",
    "Copyright",
    "Contents",
    "# Body",
    "One",
    "Two",
    "Three",
    "# Back matter",
    "Thanks",
  ]);
  assert.deepEqual(
    items.flatMap((item) => (item.kind === "row" ? [item.row.at] : [])),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    items.flatMap((item) => (item.kind === "group" ? [item.rows] : [])),
    [2, 3, 1],
  );
});

test("a section drags with its entries hidden, because they travel with it", () => {
  const items = collapse(flatten(shelf()), "Body");

  assert.deepEqual(shown(items), [
    "# Front matter",
    "Copyright",
    "Contents",
    "# Body",
    "# Back matter",
    "Thanks",
  ]);
});

test("a row dropped inside its own section counts the row it is leaving", () => {
  const items = flatten(shelf());

  const down = moveRow(items, id(items, "One"), id(items, "Three"));
  assert.deepEqual(down?.to, { heading: "Body", at: 3 });
  assert.deepEqual(shown(down?.items ?? []).slice(4), [
    "Two",
    "Three",
    "One",
    "# Back matter",
    "Thanks",
  ]);

  const up = moveRow(items, id(items, "Three"), id(items, "One"));
  assert.deepEqual(up?.to, { heading: "Body", at: 0 });
  assert.equal(up?.from, 4);
});

test("a row dropped in another section takes that section's place", () => {
  const items = flatten(shelf());

  const moved = moveRow(items, id(items, "Thanks"), id(items, "Copyright"));

  assert.equal(moved?.from, 5);
  assert.deepEqual(moved?.to, { heading: "Front matter", at: 0 });
  assert.deepEqual(shown(moved?.items ?? []), [
    "# Front matter",
    "Thanks",
    "Copyright",
    "Contents",
    "# Body",
    "One",
    "Two",
    "Three",
    "# Back matter",
  ]);
  // The list a drop leaves up counts the way the note will.
  assert.deepEqual(places(moved?.items ?? [])[1], { heading: "Front matter", at: 0 });
});

test("a section drops at the end of the list, and never splits another", () => {
  const items = collapse(flatten(shelf()), "Front matter");

  const last = moveSection(flatten(shelf()), "Front matter", id(items, "Thanks"));
  assert.equal(last?.at, 2);
  assert.deepEqual(shown(last?.items ?? []), [
    "# Body",
    "One",
    "Two",
    "Three",
    "# Back matter",
    "Thanks",
    "# Front matter",
    "Copyright",
    "Contents",
  ]);

  // A drop in the middle of another section's entries lands on the
  // nearest heading, so a section is never written into one.
  const between = moveSection(flatten(shelf()), "Back matter", id(items, "Two"));
  assert.equal(between?.at, 1);
  assert.deepEqual(shown(between?.items ?? []).slice(0, 5), [
    "# Front matter",
    "Copyright",
    "Contents",
    "# Back matter",
    "Thanks",
  ]);
});

test("nothing moves above the entries the note opens with", () => {
  const opened: Grouped[] = [
    {
      heading: "",
      rows: [
        { at: 0, name: "Loose", kind: "note", role: "chapter", named: false },
      ],
    },
    ...shelf(),
  ];
  const items = flatten(opened);

  const onto = moveSection(items, "Body", id(items, "Loose"));

  assert.equal(onto?.at, 1);
  assert.deepEqual(shown(onto?.items ?? []).slice(0, 3), [
    "Loose",
    "# Body",
    "One",
  ]);
  assert.equal(groupId("Body"), "g:Body");
});

// What this tier does not cover: what dnd-kit does between the drag
// starting and the drop, which is the e2e suite's, and the note the
// place is written into, which is the reading order's own.
