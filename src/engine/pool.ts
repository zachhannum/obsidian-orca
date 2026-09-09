/**
 * The engines orca runs, one per book.
 *
 * A worker holds the whole layout of a book, so orca caps the number of
 * workers that run at once. If a reader opens a book past the ceiling,
 * orca stops the engine that went longest without a render. Orca sets
 * that book again the next time a reader opens it.
 */

import { EngineError } from "@/engine/errors";
import { timers, type Clock } from "@/engine/loop";
import type { EngineClient } from "@/engine/session";

/** The most books orca keeps on engines at once. */
export const CEILING = 2;

/**
 * The grace: how long an engine runs after the last view on its book
 * closes, in milliseconds.
 */
export const GRACE = 60_000;

/** One worker, and the client on it. */
export interface Engine {
  readonly client: EngineClient;
  /** Stops the worker. */
  stop(): void;
}

/** The part of the pool a view reaches. */
export interface Engines {
  /** The engine of this book. Starts one if no engine runs the book. */
  client(book: string): Promise<EngineClient>;
  /** Holds a book while a view on it is open. Call what it returns to drop the hold. */
  hold(book: string): () => void;
}

/** The workers a pool starts, and the clock it runs the grace on. */
export interface Pooling {
  /** Starts one worker with the engine module in it. */
  start(book: string): Promise<Engine>;
  /** The pool calls this after a book's engine stops, so the caller drops the book. */
  gone?: ((book: string) => void) | undefined;
  ceiling?: number | undefined;
  grace?: number | undefined;
  clock?: Clock | undefined;
}

/** The engine of one book, from the call that started it. */
class Live {
  engine: Engine | undefined;
  stopped = false;
  readonly client: Promise<EngineClient>;

  constructor(
    /** The count at its last render. The lowest count is the coldest book. */
    public used: number,
    stamp: () => number,
    starting: Promise<Engine>,
  ) {
    this.client = starting.then((engine) => {
      // The pool dropped the book while its worker started, so the
      // worker runs a session nobody waits on.
      if (this.stopped) {
        engine.stop();
        throw new EngineError("the engine stopped while it was starting");
      }
      this.engine = engine;
      return stamped(engine.client, () => {
        this.used = stamp();
      });
    });
  }

  stop(): void {
    this.stopped = true;
    this.engine?.stop();
    this.engine = undefined;
  }
}

export class Pool implements Engines {
  private readonly live = new Map<string, Live>();
  /** The number of views open on each book, by the path of the book. */
  private readonly held = new Map<string, number>();
  /** Cancels the grace of a book with no view on it, by the path of the book. */
  private readonly waiting = new Map<string, () => void>();
  private readonly clock: Clock;
  private readonly grace: number;
  private limit: number;
  private used = 0;
  private closed = false;

  constructor(private readonly pooling: Pooling) {
    this.clock = pooling.clock ?? timers;
    this.grace = pooling.grace ?? GRACE;
    this.limit = capped(pooling.ceiling ?? CEILING);
  }

  /** The most books orca keeps on engines at once. */
  get ceiling(): number {
    return this.limit;
  }

  /** Sets the ceiling, and stops the coldest books above it. */
  set ceiling(books: number) {
    this.limit = capped(books);
    this.evict(0);
  }

  /**
   * The engine of this book. Starts one if no engine runs the book. A
   * second call during the start waits on the first call, so an effect
   * that mounts twice starts one worker.
   *
   * The client belongs to the engine that runs now. Ask for the client
   * again on the next render rather than keep the one you got.
   */
  client(book: string): Promise<EngineClient> {
    const running = this.live.get(book);
    if (running !== undefined) return running.client;
    if (this.closed) {
      return Promise.reject(new EngineError("orca is unloaded"));
    }
    this.evict(1);
    const live = new Live(
      this.stamp(),
      () => this.stamp(),
      this.pooling.start(book),
    );
    this.live.set(book, live);
    // The pool drops a worker that fails to start. The next open starts
    // a new worker rather than hands back the same failure again.
    live.client.catch(() => {
      if (this.live.get(book) === live) this.live.delete(book);
    });
    return live.client;
  }

  /**
   * Holds this book while a view on it is open. The engine outlives the
   * view, so a drop of the last hold starts the grace rather than stops
   * the book. If a view opens inside the grace, the book stays on its
   * engine.
   */
  hold(book: string): () => void {
    this.held.set(book, (this.held.get(book) ?? 0) + 1);
    this.unwait(book);
    let holding = true;
    return () => {
      if (!holding) return;
      holding = false;
      const rest = (this.held.get(book) ?? 1) - 1;
      if (rest > 0) {
        this.held.set(book, rest);
        return;
      }
      this.held.delete(book);
      this.wait(book);
    };
  }

  /** Stops the engine of this book, and reports the book as gone. */
  stop(book: string): void {
    const live = this.live.get(book);
    if (live === undefined) return;
    this.live.delete(book);
    this.unwait(book);
    live.stop();
    this.pooling.gone?.(book);
  }

  /** Stops every engine, when Obsidian unloads the plugin. */
  close(): void {
    this.closed = true;
    for (const book of [...this.live.keys()]) this.stop(book);
    for (const book of [...this.waiting.keys()]) this.unwait(book);
    this.held.clear();
  }

  private stamp(): number {
    return (this.used += 1);
  }

  /** Stops the coldest books until `room` more books fit under the ceiling. */
  private evict(room: number): void {
    while (this.live.size + room > this.limit) {
      const entries = [...this.live.entries()];
      const coldest = entries.reduce((cold, entry) =>
        entry[1].used < cold[1].used ? entry : cold,
      );
      this.stop(coldest[0]);
    }
  }

  /** Starts the grace that runs before orca stops the engine of this book. */
  private wait(book: string): void {
    if (!this.live.has(book)) return;
    this.unwait(book);
    this.waiting.set(
      book,
      this.clock.after(this.grace, () => {
        this.waiting.delete(book);
        if (!this.held.has(book)) this.stop(book);
      }),
    );
  }

  private unwait(book: string): void {
    const cancel = this.waiting.get(book);
    if (cancel === undefined) return;
    cancel();
    this.waiting.delete(book);
  }
}

/** A client that stamps a book on every render of it. */
function stamped(client: EngineClient, used: () => void): EngineClient {
  return {
    preview: (ops, range) => {
      used();
      return client.preview(ops, range);
    },
    exportPdf: (ops) => {
      used();
      return client.exportPdf(ops);
    },
    fontBytes: (font) => client.fontBytes(font),
    nodeAt: (source, byte) => client.nodeAt(source, byte),
    sourceOf: (node) => client.sourceOf(node),
    foliosOf: (nodes) => client.foliosOf(nodes),
    get current(): number {
      return client.current;
    },
    get stages() {
      return client.stages;
    },
  };
}

/** Rounds a ceiling to whole books, and to one book at least. */
function capped(books: number): number {
  return Number.isFinite(books) ? Math.max(1, Math.floor(books)) : CEILING;
}
