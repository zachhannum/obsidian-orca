import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Client, createEngine, type NodeSource } from "fleuron";
import { candidates, drawn, namesOf, type Drawn } from "@/ui/runs";

const root = process.env["ORCA_ROOT"] ?? process.cwd();

/** The chapter in the fixture vault that is written in every form. */
const CHAPTER = "Chapter Fifteen.md";

/** A mark, with the text of the note it covers. */
type Mark = Drawn & { text: string };

/**
 * Every mark of a note, as the engine settles them. The candidates go
 * to the same `nodeAt` and `sourceOf` the plugin asks with, so what
 * this proves is the engine's parse rather than a parser of orca's.
 */
async function marksIn(text: string): Promise<Mark[]> {
  const require = createRequire(import.meta.url);
  const engine = await createEngine({
    wasm: await readFile(require.resolve("fleuron/fleuron_bg.wasm")),
  });
  try {
    const client: Client = new Client({
      post: (request) => {
        engine.submit(request, (response) => {
          client.receive(response);
        });
      },
    });
    await client.preview([
      { op: "dialect", dialect: "obsidian" },
      { op: "split", level: 0 },
      { op: "book", sources: [{ name: CHAPTER, text }] },
    ]);
    const asked = candidates(text);
    const answers: (NodeSource | undefined)[] = [];
    for (const candidate of asked) {
      const node = await client.nodeAt(CHAPTER, candidate.byte);
      answers.push(node === null ? undefined : ((await client.sourceOf(node)) ?? undefined));
    }
    const bytes = new TextEncoder().encode(text);
    return drawn(text, asked, answers).map((mark) => ({
      ...mark,
      text: new TextDecoder().decode(bytes.subarray(mark.from, mark.to)),
    }));
  } finally {
    engine.free();
  }
}

/** The fixture chapter, as it is checked in. */
function chapter(): Promise<string> {
  return readFile(path.join(root, "fixture", CHAPTER), "utf8");
}

test("the fixture chapter is written in every form, and the engine settles each one", async () => {
  const marks = await marksIn(await chapter());

  assert.deepEqual(
    marks.map((mark) => [mark.form, mark.text]),
    [
      ["line", "{.chapter-opening #fifteen}"],
      ["setext", "============="],
      ["heading", " {.plain #entail}"],
      ["setext", "------------------------"],
      ["span", "{.character}"],
      ["line", "{.epigraph}"],
      ["image", "{.plate}"],
    ],
  );
});

test("a setext heading takes the level of its underline, over one line or many", async () => {
  const marks = await marksIn("One\n===\n\nTwo\nAnd more\n---\n");

  assert.deepEqual(
    marks.map((mark) => [mark.text, mark.level]),
    [
      ["===", 1],
      ["---", 2],
    ],
  );
});

test("a run the engine does not read is left as the author wrote it", async () => {
  const text = [
    // An element answers to one name, so a second id is no run.
    "{#one #two}",
    "",
    "A paragraph.",
    "",
    "![[device.png]]{not a run}",
    "",
    // The image moves under the paragraph, and the run is that
    // paragraph's own text.
    "Look ![[device.png]]{.plate} beside.",
    "",
    "[bare] {.spaced}",
    "",
  ].join("\n");

  const marks = await marksIn(text);

  assert.deepEqual(marks, []);
});

test("an attribute line over a row of dashes names the scene break under it", async () => {
  const marks = await marksIn("{.ornament}\n---\n\nA paragraph.\n");

  assert.deepEqual(
    marks.map((mark) => [mark.form, mark.text]),
    [["line", "{.ornament}"]],
  );
});

test("a run after a bracket closes its span, and the heading keeps the run at its end", async () => {
  const marks = await marksIn("# [Chapter One]{.number} The Road {#road .title}\n");

  assert.deepEqual(
    marks.map((mark) => [mark.form, mark.text]),
    [
      ["span", "{.number}"],
      ["heading", " {#road .title}"],
    ],
  );
});

test("a chip names the id and the classes, and a run with neither is drawn as it was written", () => {
  assert.deepEqual(namesOf(".title #road"), {
    id: "road",
    classes: ["title"],
    said: ".title #road",
  });
  assert.deepEqual(namesOf("#road"), { id: "road", classes: [], said: "#road" });
  assert.deepEqual(namesOf(".one .two"), {
    id: undefined,
    classes: ["one", "two"],
    said: ".one .two",
  });
  // The engine reads this run on a heading and cannot use it, so the
  // chip says what was written rather than nothing.
  assert.deepEqual(namesOf("key=value"), {
    id: undefined,
    classes: [],
    said: "key=value",
  });
});

test("a candidate is proposed by shape, and every byte it names is a byte of the note", async () => {
  const text = await chapter();
  const bytes = new TextEncoder().encode(text).length;

  const asked = candidates(text);

  assert.ok(asked.length > 0);
  for (const candidate of asked) {
    assert.ok(candidate.byte >= 0 && candidate.byte < bytes, "the ask is inside the note");
    assert.ok(candidate.from < candidate.to, "a mark covers bytes");
    assert.ok(candidate.to <= bytes, "a mark ends inside the note");
  }
});

// What this tier does not cover: the decorations themselves, which
// need an editor on a page, and the chips reading view draws. The e2e
// suite opens the fixture chapter in Obsidian in both views and reads
// the chip off each form.
