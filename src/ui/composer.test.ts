import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import type { Folios, LayoutOutput, Op, Page } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { bookDesign } from "@/book/design";
import { readFrontmatter } from "@/book/frontmatter";
import { pathLinks } from "@/book/links";
import { readModel } from "@/book/model";
import type { Face } from "@/book/plan";
import type { Clock } from "@/engine/loop";
import type { Engines } from "@/engine/pool";
import type { EngineClient, FaceSet, Range, Stages } from "@/engine/session";
import {
  Composer,
  type Composing,
  type Progress,
  type Typeset,
} from "@/ui/composer";

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

/** A pool that starts a client of its own each time a book is set. */
class Clients {
  readonly started: FakeClient[] = [];

  readonly engines: Engines = {
    client: () => {
      const client = new FakeClient();
      this.started.push(client);
      return Promise.resolve(client);
    },
    hold: () => () => undefined,
    retry: () => undefined,
  };
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
  const links = pathLinks(found);
  return {
    model: async (at) => readModel(await readText(vault, at)),
    design: async (at) =>
      bookDesign((await readModel(await readText(vault, at))).book, at, links, {
        properties: async (note) =>
          readFrontmatter(await readText(vault, note)).properties,
      }),
    read: (at) => readText(vault, at),
    files: vault,
    name: (at) => path.basename(at, ".md"),
    cuts: () => Promise.resolve([]),
    links,
    engines: {
      client: () => Promise.resolve(client),
      hold: () => () => undefined,
      retry: () => undefined,
    },
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
  await crossed(book, clock);

  // The words go first and the bytes follow, so the engine reads the
  // chapter and is then given the file it now names.
  const sent = client.rendered.slice(renders).flat();
  assert.deepEqual(sent.map((op) => op.op), ["edit", "image"]);
  const image = sent.find((op) => op.op === "image");
  assert.equal(image?.url, "images/device.png");
  assert.deepEqual(
    image?.bytes,
    new Uint8Array(await vault.readBinary("images/device.png")),
  );
  // One file has one set of pixels, whichever url draws it.
  assert.equal(
    book.assets.imageUrl("images/device.png"),
    book.assets.imageUrl("device.png"),
  );

  // A url the engine already holds crosses no second time.
  composer.retype(BOOK, note, `${copyright}\n\n![[images/device.png]]\n\n.`);
  await crossed(book, clock);
  assert.deepEqual(
    client.rendered.slice(renders).flat().map((op) => op.op),
    ["edit", "image", "edit"],
  );
});

/**
 * Waits out the reads an embed costs, then steps the loop the ops they
 * planned are waiting on. The book says when it has finished resolving,
 * so nothing here waits on a clock or on a count of turns.
 */
async function crossed(book: Typeset, clock: Steps): Promise<void> {
  // The composer reaches the book on a microtask, so the retype has to
  // land before the promise it started can be read.
  await drain();
  await book.resolving;
  clock.tick();
  await drain();
}

test("a book whose engine died is set again from what crossed, cuts and all", async () => {
  const clock = new Steps();
  const clients = new Clients();
  const cut: Face = { key: "spectral-regular", bytes: new Uint8Array([1, 2, 3]) };
  const composer = new Composer(
    { ...(await setting(new FakeClient())), engines: clients.engines, cuts: () => Promise.resolve([cut]) },
    clock,
  );

  const book = await composer.open(BOOK);
  book.reface("Spectral", [cut]);
  await crossed(book, clock);
  // The keystroke is on this thread and nowhere else: the wait has not
  // run, so the engine that dies never saw it.
  composer.retype(BOOK, "Chapter Twelve.md", "# Chapter Twelve\n\nIt is a truth.\n");
  await drain();

  let told = 0;
  book.watch(() => {
    told += 1;
  });
  composer.died(BOOK);
  await drain();

  assert.equal(book.dropped, true);
  assert.equal(told, 1, "the views on a dead book are told to set it again");

  const said: Progress[] = [];
  const again = await composer.open(BOOK, {
    told: (at) => said.push(at),
  });
  assert.equal(clients.started.length, 2, "the book went onto a second engine");
  // The pane says what it is doing, and says it is doing it again.
  assert.deepEqual(
    said.map((at) => at.again),
    said.map(() => true),
  );
  assert.ok(said.length > 0);
  const opened = clients.started[1]?.rendered[0] ?? [];
  const sources = opened.find((op) => op.op === "book");
  assert.ok(sources?.op === "book");
  const chapter = sources.sources.find((source) => source.name === "Chapter Twelve.md");
  assert.match(chapter?.text ?? "", /It is a truth\./);
  // The face is registered for one session, and that session is gone,
  // so the cuts cross again ahead of the sheets that name them.
  assert.deepEqual(
    opened.filter((op) => op.op === "font").map((op) => [...op.bytes]),
    [[1, 2, 3]],
  );
  assert.equal(again.face, "Spectral");
  const styled = opened.at(-1);
  assert.equal(styled?.op, "style");
});

// What this tier does not cover: the engine's own pagination, so the
// folios here are the fake client's. The e2e suite is where a real
// chapter opens on the page the real run put it on, and where a reflow
// moves it.
