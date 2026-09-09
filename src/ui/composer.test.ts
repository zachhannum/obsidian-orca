import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import type { Folios, LayoutOutput, Op, Page } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel } from "@/book/model";
import type { Clock } from "@/engine/loop";
import type { EngineClient, FaceSet, Range, Stages } from "@/engine/session";
import { Composer, type Progress, type Composing } from "@/ui/composer";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

const BOOK = "Pride and Prejudice.md";

/** The pages each section of the fake book is typeset to. */
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
  /** The text of each source the book op sent, by the name it sent it under. */
  private sent: { name: string; text: string }[] = [];

  private get sources(): number {
    return this.sent.length;
  }

  preview(ops: Op[] = [], range?: Range): Promise<LayoutOutput | null> {
    if (ops.length > 0) {
      this.rendered.push(ops);
      this.current += 1;
      for (const op of ops) {
        if (op.op === "book") {
          this.sent = op.sources.map(({ name, text }) => ({ name, text }));
        }
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

  /**
   * The section a byte falls in, as a real engine does: nothing for a
   * byte of the source's frontmatter, which was read into no node.
   */
  nodeAt(source: string, byte: number): Promise<number | null> {
    const at = this.sent.findIndex((sent) => sent.name === source);
    const text = this.sent[at]?.text;
    if (text === undefined) return Promise.resolve(null);
    const written = new TextEncoder().encode(text).indexOf(0x23);
    return Promise.resolve(byte < written ? null : at * 10 + 5);
  }

  sourceOf(node: number): Promise<null> {
    void node;
    return Promise.resolve(null);
  }

  foliosOf(nodes: number[]): Promise<(Folios | null)[]> {
    return Promise.resolve(
      nodes.map((node) => {
        const at = Math.floor(node / 10);
        if (at * 10 + 5 !== node || at >= this.sources) return null;
        return {
          first: at * SPREAD + 1,
          last: at * SPREAD + SPREAD,
          at: at * SPREAD,
          count: SPREAD,
        };
      }),
    );
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
class PausedClient extends FakeClient {
  private waiting: (() => void)[] | undefined;

  /** Holds every reply from here on. */
  hold(): void {
    this.waiting = [];
  }

  /** The replies paused so far. */
  get holding(): number {
    return this.waiting?.length ?? 0;
  }

  /** Lets every reply paused since then run. */
  release(): void {
    const paused = this.waiting ?? [];
    this.waiting = undefined;
    for (const resume of paused) resume();
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

/** Every file in the fixture vault, the way Obsidian sees one. */
async function paths(folder = "/"): Promise<string[]> {
  const { files, folders } = await vault.list(folder);
  const under = await Promise.all(folders.map((at) => paths(at)));
  return [...files, ...under.flat()];
}

async function setting(client: EngineClient): Promise<Composing> {
  const found = await paths();
  return {
    model: async (at) => readModel(await readText(vault, at)),
    read: (at) => readText(vault, at),
    files: vault,
    name: (at) => path.basename(at, ".md"),
    links: pathLinks(found),
    client: Promise.resolve(client),
    faces: faces(),
  };
}

test("a book is set from its reading order, and no page of it comes back to say where", async () => {
  const client = new FakeClient();
  const composer = new Composer(await setting(client));

  const book = await composer.open(BOOK);

  assert.equal(book.name, "Pride and Prejudice");
  assert.equal(book.sections.length, 8);
  // Setting the book asks for the window the first view paints, not
  // for every page of it to work out where the sections landed.
  assert.deepEqual(client.ranges, [{ first: 0, count: 2 }]);
});

test("a section says where it opens now, asked of the engine at the ask", async () => {
  const client = new FakeClient();
  const composer = new Composer(await setting(client));

  const book = await composer.open(BOOK);

  // Chapter Twelve is the sixth section sent, so it opens on the
  // eleventh page: the answer counts pages from 0.
  assert.equal(await book.opens(5), 10);
  // The fixture names a chapter the vault does not have, so nothing
  // crossed for it and it opens nowhere.
  assert.equal(await book.opens(6), undefined);
  assert.equal(await book.opens(7), 12);
  // Matter orca generated is asked about under the name it crossed as.
  assert.equal(await book.opens(0), 0);
});

test("a book being set reports the sections it has read and the entry it opens at", async () => {
  const client = new FakeClient();
  const composer = new Composer(await setting(client));
  const told: Progress[] = [];

  await composer.open(BOOK, {
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

test("a book already set is handed back rather than typeset again", async () => {
  const client = new FakeClient();
  const composer = new Composer(await setting(client));

  const book = await composer.open(BOOK);
  assert.equal(await composer.open(BOOK), book);
  assert.equal(client.rendered.length, 1);

  composer.forget(BOOK);
  assert.notEqual(await composer.open(BOOK), book);
  assert.equal(client.rendered.length, 2);
});

test("a burst of keystrokes leaves the pages last painted up until the render lands", async () => {
  const clock = new Steps();
  const client = new PausedClient();
  const composer = new Composer(await setting(client), clock);
  const book = await composer.open(BOOK);
  const renders = client.rendered.length;
  let painted = 0;
  book.watch(() => {
    painted += 1;
  });

  client.hold();
  for (const text of ["It i", "It is", "It is a"]) {
    composer.retype(BOOK, "Chapter Twelve.md", text);
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

  assert.equal(client.rendered.length, renders + 1);
  assert.deepEqual(client.rendered.at(-1), [
    { op: "edit", name: "Chapter Twelve.md", text: "It is a" },
  ]);
  assert.equal(painted, 1);
});

test("a chapter the engine already has the words of is no edit at all", async () => {
  const clock = new Steps();
  const client = new FakeClient();
  const composer = new Composer(await setting(client), clock);
  await composer.open(BOOK);
  const renders = client.rendered.length;

  // The note is written to disk after the keystrokes that made it, and
  // it arrives back as the text the engine was already sent.
  composer.retype(BOOK, "Chapter Twelve.md", await readText(vault, "Chapter Twelve.md"));
  await drain();
  clock.tick();
  await drain();

  assert.equal(client.rendered.length, renders);
});

test("an image a chapter picks up while it is drafted crosses on the next render", async () => {
  const clock = new Steps();
  const client = new FakeClient();
  const composer = new Composer(await setting(client), clock);
  const book = await composer.open(BOOK);
  const renders = client.rendered.length;
  const note = "Copyright.md";
  const copyright = await readText(vault, note);

  // The same file the acknowledgements embed, under a url of its own.
  composer.retype(BOOK, note, `${copyright}\n\n![[images/device.png]]\n`);
  await settled(clock);

  // The words go first and the bytes follow: the engine reads the
  // chapter, then is given the file the chapter now names.
  const sent = client.rendered.slice(renders).flat();
  assert.deepEqual(sent.map((op) => op.op), ["edit", "image"]);
  const image = sent.find((op) => op.op === "image");
  assert.equal(image?.url, "images/device.png");
  assert.deepEqual(
    image?.bytes,
    new Uint8Array(await vault.readBinary("images/device.png")),
  );
  // One file, one set of pixels, whichever url a page draws it by.
  assert.equal(
    book.assets.imageUrl("images/device.png"),
    book.assets.imageUrl("device.png"),
  );

  // A url the engine already holds crosses no second time.
  composer.retype(BOOK, note, `${copyright}\n\n![[images/device.png]]\n\n.`);
  await settled(clock);
  assert.deepEqual(
    client.rendered.slice(renders).flat().map((op) => op.op),
    ["edit", "image", "edit"],
  );
});

/**
 * Runs the reads and the hashing an embed costs, and the ticks the
 * renders they plan wait on. Every turn here is a turn of the loop the
 * work is already queued on rather than a wait on a clock.
 */
async function settled(clock: Steps): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await drain();
    clock.tick();
  }
  await drain();
}

// What this tier does not cover: the engine's own pagination, so the
// folios here are the fake client's. The e2e suite is where a real
// chapter opens on the page the real run put it on, and where a reflow
// moves it.
