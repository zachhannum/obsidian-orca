import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import type { LayoutOutput, Op, Page } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel } from "@/book/model";
import type { Clock } from "@/engine/loop";
import type { EngineClient, FaceSet, Range, Stages } from "@/engine/session";
import { Setter, type Progress, type Setting } from "@/ui/setter";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

const BOOK = "Pride and Prejudice.md";

/** The pages each section of the fake book is laid out to. */
const SPREAD = 2;

/**
 * A book of two pages per source, each page naming the id of the
 * section it came from. Ids run in document order and are not
 * consecutive, which is what a real run gives.
 */
class FakeClient implements EngineClient {
  readonly rendered: Op[][] = [];
  readonly ranges: Range[] = [];
  current = 0;
  stages: Stages = { style: 0, lines: 0, flow: 0, paint: 0 };
  private sources = 0;

  preview(ops: Op[] = [], range?: Range): Promise<LayoutOutput | null> {
    if (ops.length > 0) {
      this.rendered.push(ops);
      this.current += 1;
      for (const op of ops) {
        if (op.op === "book") this.sources = op.sources.length;
      }
    }
    if (range !== undefined) this.ranges.push(range);
    const book = this.pages();
    const first = range?.first ?? 0;
    const count = range?.count ?? book.length;
    return Promise.resolve({
      pages: book.slice(first, first + count),
      first,
      bookPages: book.length,
      fonts: [],
      assets: [],
      warnings: [],
    });
  }

  exportPdf(): Promise<Uint8Array | null> {
    return Promise.resolve(new Uint8Array());
  }

  fontBytes(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  private pages(): Page[] {
    return Array.from({ length: this.sources * SPREAD }, (_, at) => ({
      number: at + 1,
      side: at % 2 === 0 ? ("recto" as const) : ("verso" as const),
      width: 432,
      height: 648,
      sections: [Math.floor(at / SPREAD) * 10 + 5],
      items: [],
    }));
  }
}

/** A client that holds its replies from the moment the test says so. */
class HeldClient extends FakeClient {
  private waiting: (() => void)[] | undefined;

  /** Holds every reply from here on. */
  hold(): void {
    this.waiting = [];
  }

  /** The replies held back so far. */
  get holding(): number {
    return this.waiting?.length ?? 0;
  }

  /** Lets every reply held since then run. */
  release(): void {
    const held = this.waiting ?? [];
    this.waiting = undefined;
    for (const resume of held) resume();
  }

  override async preview(
    ops: Op[] = [],
    range?: Range,
  ): Promise<LayoutOutput | null> {
    const waiting = this.waiting;
    if (waiting !== undefined) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    return super.preview(ops, range);
  }
}

/** A clock the test steps itself, so nothing here waits on a real one. */
class Steps implements Clock {
  private waiting: (() => void)[] = [];

  after(_ms: number, fire: () => void): () => void {
    const at = this.waiting.length;
    this.waiting.push(fire);
    return () => {
      this.waiting[at] = () => undefined;
    };
  }

  /** Runs every wait that has come due and not been cancelled. */
  tick(): void {
    const due = this.waiting;
    this.waiting = [];
    for (const fire of due) fire();
  }
}

/** Lets the promises already settled run before the test looks again. */
function drain(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function faces(): FaceSet {
  return { add: () => Promise.resolve() };
}

async function setting(client: EngineClient): Promise<Setting> {
  const paths = (await vault.list("/")).files;
  return {
    model: async (at) => readModel(await readText(vault, at)),
    read: (at) => readText(vault, at),
    name: (at) => path.basename(at, ".md"),
    links: pathLinks(paths),
    client: Promise.resolve(client),
    faces: faces(),
  };
}

test("a book is set from its reading order, and every section keeps its folios", async () => {
  const client = new FakeClient();
  const setter = new Setter(await setting(client));

  const laid = await setter.open(BOOK);

  assert.equal(laid.name, "Pride and Prejudice");
  assert.equal(laid.sections.length, 8);
  // The fixture names a chapter the vault does not have, so the book
  // is set without it and it has no folios of its own.
  assert.deepEqual(laid.ranges.get(5), { first: 11, last: 12 });
  assert.equal(laid.ranges.get(6), undefined);
  assert.deepEqual(laid.ranges.get(7), { first: 13, last: 14 });
  // The whole book comes back once, because a section's id says where
  // it falls only against every other id in the book.
  assert.deepEqual(client.ranges.at(-1), { first: 0, count: 14 });
});

test("a book being set reports the sections it has read and the entry it opens at", async () => {
  const client = new FakeClient();
  const setter = new Setter(await setting(client));
  const told: Progress[] = [];

  await setter.open(BOOK, {
    note: "Chapter Twelve.md",
    told: (at) => told.push(at),
  });

  const first = told[0];
  const last = told.at(-1);
  assert.ok(first && last);
  assert.equal(first.name, "Pride and Prejudice");
  assert.equal(first.of, 7);
  // A generated section is written rather than read, so it is done
  // before the first note is opened.
  assert.equal(first.read, 2);
  assert.equal(last.read, 7);
  assert.equal(last.opening, "Chapter Twelve");
});

test("a book already set is handed back rather than laid out again", async () => {
  const client = new FakeClient();
  const setter = new Setter(await setting(client));

  const laid = await setter.open(BOOK);
  assert.equal(await setter.open(BOOK), laid);
  assert.equal(client.rendered.length, 1);

  setter.forget(BOOK);
  assert.notEqual(await setter.open(BOOK), laid);
  assert.equal(client.rendered.length, 2);
});

test("a burst of keystrokes leaves the pages last painted up until the render lands", async () => {
  const clock = new Steps();
  const client = new HeldClient();
  const setter = new Setter(await setting(client), clock);
  const laid = await setter.open(BOOK);
  const laying = client.rendered.length;
  let painted = 0;
  laid.watch(() => {
    painted += 1;
  });

  client.hold();
  for (const text of ["It i", "It is", "It is a"]) {
    setter.retype(BOOK, "Chapter Twelve.md", text);
  }
  await drain();
  clock.tick();
  await drain();

  // Three keystrokes, one render, and it has not answered yet: no view
  // has been told to repaint, so the pages already on screen are still
  // the last ones painted.
  assert.equal(client.holding, 1);
  assert.equal(painted, 0);

  client.release();
  await drain();

  assert.equal(client.rendered.length, laying + 1);
  assert.deepEqual(client.rendered.at(-1), [
    { op: "edit", name: "Chapter Twelve.md", text: "It is a" },
  ]);
  assert.equal(painted, 1);
});

test("a chapter the engine already has the words of is no edit at all", async () => {
  const clock = new Steps();
  const client = new FakeClient();
  const setter = new Setter(await setting(client), clock);
  await setter.open(BOOK);
  const laying = client.rendered.length;

  // The note is written to disk after the keystrokes that made it, and
  // it arrives back as the text the engine was already sent.
  setter.retype(BOOK, "Chapter Twelve.md", await readText(vault, "Chapter Twelve.md"));
  await drain();
  clock.tick();
  await drain();

  assert.equal(client.rendered.length, laying);
});

// What this tier does not cover: the engine's own pagination, so the
// folios here are the fake client's. The e2e suite is where a real
// chapter opens on the page the real run put it on. A render does not
// work the folio ranges out again, so a chapter an edit moved keeps the
// range the book was set with until the book is set again. Asking for
// them costs the whole book over the wire, which is what a page-through
// exists to avoid.
