import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayoutOutput } from "fleuron";
import type { Clock } from "@/engine/loop";
import { Pool, type Engine } from "@/engine/pool";
import type { EngineClient, Stages } from "@/engine/session";

/** A clock the test steps by hand, so no test waits on a real clock. */
class Steps implements Clock {
  private waiting: (() => void)[] = [];

  after(_ms: number, fire: () => void): () => void {
    const at = this.waiting.length;
    this.waiting.push(fire);
    return () => {
      this.waiting[at] = () => undefined;
    };
  }

  /** Runs every wait that is due and not cancelled. */
  tick(): void {
    const due = this.waiting;
    this.waiting = [];
    for (const fire of due) fire();
  }
}

/** A client that renders nothing and counts the calls it gets. */
class FakeClient implements EngineClient {
  current = 0;
  stages: Stages = { style: 0, lines: 0, flow: 0, paint: 0 };

  preview(): Promise<LayoutOutput | null> {
    this.current += 1;
    return Promise.resolve({
      pages: [],
      first: 0,
      bookPages: 0,
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

  nodeAt(): Promise<number | null> {
    return Promise.resolve(null);
  }

  sourceOf(): Promise<null> {
    return Promise.resolve(null);
  }

  foliosOf(): Promise<null[]> {
    return Promise.resolve([]);
  }
}

/** The workers a pool started, and which of them still run. */
class Workers {
  readonly started: string[] = [];
  readonly stopped: string[] = [];
  readonly gone: string[] = [];

  start = (book: string): Promise<Engine> => {
    this.started.push(book);
    return Promise.resolve({
      client: new FakeClient(),
      stop: () => {
        this.stopped.push(book);
      },
    });
  };

  /** The books whose worker still runs, in the order the pool started them. */
  get running(): string[] {
    const stopped = [...this.stopped];
    return this.started.filter((book) => {
      const at = stopped.indexOf(book);
      if (at < 0) return true;
      stopped.splice(at, 1);
      return false;
    });
  }
}

test("a second book gets a second worker, and a third stops the coldest", async () => {
  const workers = new Workers();
  const pool = new Pool({
    start: workers.start,
    gone: (book) => workers.gone.push(book),
    clock: new Steps(),
  });

  const first = await pool.client("one.md");
  const second = await pool.client("two.md");
  assert.deepEqual(workers.started, ["one.md", "two.md"]);
  assert.deepEqual(workers.running, ["one.md", "two.md"]);

  // The first book renders after the second, so the second book went
  // longest without a render.
  await second.preview();
  await first.preview();
  await pool.client("three.md");

  assert.deepEqual(workers.started, ["one.md", "two.md", "three.md"]);
  assert.deepEqual(workers.stopped, ["two.md"]);
  assert.deepEqual(workers.gone, ["two.md"]);
  assert.deepEqual(workers.running, ["one.md", "three.md"]);
});

test("closing the last view on a book stops it once the grace runs out", async () => {
  const workers = new Workers();
  const clock = new Steps();
  const pool = new Pool({
    start: workers.start,
    gone: (book) => workers.gone.push(book),
    clock,
  });

  const opened = pool.hold("one.md");
  const reopened = pool.hold("one.md");
  await pool.client("one.md");

  opened();
  clock.tick();
  assert.deepEqual(workers.stopped, [], "a book still open on a leaf stays");

  reopened();
  // The grace runs, and a book inside the grace stays on the engine.
  assert.deepEqual(workers.stopped, []);
  clock.tick();

  assert.deepEqual(workers.stopped, ["one.md"]);
  assert.deepEqual(workers.gone, ["one.md"]);
});

test("a view opened inside the grace keeps the book on the engine", async () => {
  const workers = new Workers();
  const clock = new Steps();
  const pool = new Pool({ start: workers.start, clock });

  const opened = pool.hold("one.md");
  await pool.client("one.md");
  opened();
  pool.hold("one.md");
  clock.tick();

  assert.deepEqual(workers.stopped, []);
});

test("the ceiling settles how many books stay on the engine", async () => {
  const workers = new Workers();
  const pool = new Pool({ start: workers.start, ceiling: 4, clock: new Steps() });

  for (const book of ["one.md", "two.md", "three.md", "four.md"]) {
    await pool.client(book);
  }
  assert.deepEqual(workers.stopped, []);
  assert.equal(pool.ceiling, 4);

  // The reader lowered the ceiling, so the books above it stop, coldest
  // first.
  pool.ceiling = 2;
  assert.deepEqual(workers.stopped, ["one.md", "two.md"]);
  assert.deepEqual(workers.running, ["three.md", "four.md"]);

  // The ceiling is one book at least, because orca reads a book by
  // setting it on an engine.
  pool.ceiling = 0;
  assert.equal(pool.ceiling, 1);
});

test("a book opened twice before its worker starts gets one worker", async () => {
  const workers = new Workers();
  const pool = new Pool({ start: workers.start, clock: new Steps() });

  // The two mounts of a double mount, and the unmount between them.
  const first = pool.hold("one.md");
  const opening = pool.client("one.md");
  first();
  pool.hold("one.md");
  const again = pool.client("one.md");

  assert.equal(await opening, await again);
  assert.deepEqual(workers.started, ["one.md"]);
  assert.deepEqual(workers.stopped, []);
});

// What this tier does not cover: the grace itself, because the test
// steps the clock rather than runs it, and the memory a worker holds,
// which is the reason for the ceiling. The e2e run covers whether two
// books fit on a machine at once.
