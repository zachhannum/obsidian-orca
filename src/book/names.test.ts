import assert from "node:assert/strict";
import { test } from "node:test";
import { sectionIds, sectionNames, slug } from "@/book/names";
import type { Section } from "@/book/order";
import type { Role } from "@/book/roles";

function note(path: string, role: Role = "chapter", alias?: string): Section {
  const link = path.replace(/\.md$/, "").split("/").at(-1) ?? path;
  const entry = alias === undefined ? { link, role, heading: "" } : { link, alias, role, heading: "" };
  return { kind: "note", entry, path };
}

function generated(role: Role): Section {
  return { kind: "generated", entry: { role, tag: role, heading: "" } };
}

test("each section takes its role as its class", () => {
  const names = sectionNames([
    generated("title-page"),
    note("Copyright.md", "copyright"),
    generated("contents"),
    note("The Harbor.md"),
  ]);

  assert.deepEqual(
    names.map((name) => name.classes),
    [["title-page"], ["copyright"], ["contents"], ["chapter"]],
  );
});

test("an id is a slug of the entry's name, and generated matter is named by its role", () => {
  const names = sectionNames([
    generated("title-page"),
    generated("contents"),
    note("Chapters/The Harbor.md"),
    note("Élan, vital!.md"),
    note("Other.md", "chapter", "A Night Out"),
  ]);

  assert.deepEqual(
    names.map((name) => name.id),
    ["title-page", "contents", "the-harbor", "elan-vital", "a-night-out"],
  );
  // A slug a selector cannot read on its own takes the role in front.
  assert.equal(slug("1984", "chapter"), "chapter-1984");
  assert.equal(slug("***", "chapter"), "chapter");
});

test("a missing section takes no name, so the names line up with what is sent", () => {
  const names = sectionNames([
    note("A.md"),
    { kind: "missing", entry: { link: "Gone", role: "chapter", heading: "" } },
    note("B.md"),
  ]);

  assert.deepEqual(names.map((name) => name.id), ["a", "b"]);
});

test("ids are unique within the book", () => {
  const ids = sectionIds([
    note("One/The Harbor.md"),
    note("Two/The Harbor.md"),
    note("The Harbor 2.md"),
    note("Three/The Harbor.md"),
    generated("contents"),
    generated("contents"),
  ]).map((named) => named.id);

  assert.deepEqual(ids, [
    "the-harbor",
    "the-harbor-4",
    "the-harbor-2",
    "the-harbor-3",
    "contents",
    "contents-2",
  ]);
  assert.equal(new Set(ids).size, ids.length);
});

/** A small seeded generator, so a failing shuffle can be run again. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let at = out.length - 1; at > 0; at -= 1) {
    const other = Math.floor(next() * (at + 1));
    const here = out[at];
    const there = out[other];
    if (here === undefined || there === undefined) continue;
    out[at] = there;
    out[other] = here;
  }
  return out;
}

test("a reorder moves no section's id", () => {
  const book: Section[] = [
    generated("title-page"),
    note("Copyright.md", "copyright"),
    generated("contents"),
    note("Volume the First.md", "part"),
    note("One/The Harbor.md"),
    note("Two/The Harbor.md"),
    note("The Harbor 2.md"),
    note("Three/The Harbor.md", "chapter", "The Harbor"),
    note("1984.md"),
    note("Acknowledgements.md", "back-matter"),
  ];
  const key = (section: Section): string =>
    section.kind === "note" ? section.path : section.entry.role;
  const before = new Map(
    sectionIds(book).flatMap((named, at) => {
      const section = book[at];
      return section === undefined ? [] : [[key(section), named.id] as const];
    }),
  );

  for (let seed = 1; seed <= 200; seed += 1) {
    const order = shuffled(book, random(seed));
    const after = sectionIds(order);
    after.forEach((named, at) => {
      const section = order[at];
      assert.ok(section);
      assert.equal(named.id, before.get(key(section)), `seed ${seed}`);
    });
  }
});

// What this tier does not cover: an id reaching the engine and a
// selector matching it, which the plan tier tests on the fixture book,
// and a sheet written against an id, which is the style module's.
