import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { readModel, type Model } from "@/book/model";
import { Writer, type Clock } from "@/ui/writer";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The settle, run when the test says so. */
function held(): Clock & { settle(): void } {
  let fire: (() => void) | undefined;
  return {
    after(_ms, run) {
      fire = run;
      return () => {
        fire = undefined;
      };
    },
    settle() {
      const run = fire;
      fire = undefined;
      run?.();
    },
  };
}

/** One turn of the event loop, so a save that is already running finishes. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** A writer over the fixture book, with the models it painted and saved. */
async function writing(save?: (model: Model) => Promise<void>): Promise<{
  writer: Writer;
  clock: Clock & { settle(): void };
  painted: Model[];
  saved: Model[];
}> {
  const model = readModel(await readText(vault, BOOK));
  const painted: Model[] = [];
  const saved: Model[] = [];
  const clock = held();
  const writer = new Writer(
    model,
    {
      paint: (book) => painted.push(book),
      save: async (book) => {
        saved.push(book);
        await save?.(book);
      },
    },
    clock,
  );
  return { writer, clock, painted, saved };
}

/** One frame of a dragged control, which the metadata stands in for. */
function drag(name: string): (model: Model) => Model {
  return (model) => ({
    ...model,
    book: { ...model.book, metadata: { ...model.book.metadata, title: name } },
  });
}

function titles(models: Model[]): (string | undefined)[] {
  return models.map((model) => model.book.metadata.title);
}

test("a dragged control repaints per frame and writes once, on settle", async () => {
  const { writer, clock, painted, saved } = await writing();

  for (let frame = 0; frame < 40; frame += 1) writer.edit(drag(`Frame ${frame}`));

  // Every frame is on the surfaces already and none of them is on
  // disk: the settle restarts on each one.
  assert.equal(painted.length, 40);
  assert.equal(writer.generation, 40);
  assert.deepEqual(saved, []);
  assert.equal(writer.dirty, true);

  clock.settle();
  await tick();

  assert.deepEqual(titles(saved), ["Frame 39"]);
  assert.equal(writer.dirty, false);

  // A settle with no unwritten edit writes nothing.
  clock.settle();
  await tick();
  assert.equal(saved.length, 1);
});

test("an external change reloads a clean view and asks a dirty one", async () => {
  const { writer, clock, painted, saved } = await writing();
  const outside = readModel(
    (await readText(vault, BOOK)).replace(
      "title: Pride and Prejudice",
      "title: First Impressions",
    ),
  );

  assert.equal(writer.arrived(), "reload");

  writer.edit(drag("Dragged"));
  assert.equal(writer.arrived(), "ask");

  // The author keeps the edit: the settle writes it over the note, and
  // the next change on disk arrives at a clean view.
  clock.settle();
  await tick();
  assert.deepEqual(titles(saved), ["Dragged"]);
  assert.equal(writer.arrived(), "reload");

  // The author takes the note instead: the unwritten edit is dropped,
  // what is on disk is painted, and nothing is written.
  writer.edit(drag("Dropped"));
  writer.take(outside);
  clock.settle();
  await tick();

  assert.equal(writer.model.book.metadata.title, "First Impressions");
  assert.equal(titles(painted).at(-1), "First Impressions");
  assert.equal(writer.dirty, false);
  assert.equal(saved.length, 1);
});

test("a save that is running delays the next one, so two writes cannot cross", async () => {
  let land: (() => void) | undefined;
  const { writer, saved } = await writing(
    async () =>
      new Promise<void>((resolve) => {
        land = resolve;
      }),
  );

  writer.edit(drag("First"));
  const first = writer.flush();
  await tick();
  assert.deepEqual(titles(saved), ["First"]);

  writer.edit(drag("Second"));
  const second = writer.flush();
  await tick();
  assert.deepEqual(titles(saved), ["First"]);

  land?.();
  await first;
  await tick();
  assert.deepEqual(titles(saved), ["First", "Second"]);

  land?.();
  await second;
  assert.equal(writer.dirty, false);
});

// What this tier does not cover: the prompt the author answers, and the
// two halves the view writes through Obsidian, which the e2e job
// drives.
