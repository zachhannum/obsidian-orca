/**
 * The engines orca is running, one per book.
 *
 * A worker holds the whole of a book's layout, so the number running at
 * once is capped rather than left to the workspace. Opening a book past
 * the ceiling stops the engine that went longest without a render, and
 * the book on it is set again the next time it is opened.
 */

import { EngineError } from "@/engine/errors";
import { timers, type Clock } from "@/engine/loop";
import type { EngineClient } from "@/engine/session";

/** Books on the engine at once, before opening one stops another. */
export const CEILING = 2;

/** Idle time before a book no view is open on is stopped, in milliseconds. */
export const GRACE = 60_000;

/** One worker, and the client on it. */
export interface Engine {
  readonly client: EngineClient;
  /** Terminates the worker. */
  stop(): void;
}

/** The pool, as a view reaches it. */
export interface Engines {
  /** The engine a book is set on, started if it is not running. */
  client(book: string): Promise<EngineClient>;
  /** A view on a book, held while the view is open. */
  hold(book: string): () => void;
}

/** The workers a pool starts, and the clock its grace runs on. */
export interface Pooling {
  /** Starts one worker with the engine module in it. */
  start(book: string): Promise<Engine>;
  /** Told when a book's engine has stopped, so what was set on it is dropped. */
  gone?: ((book: string) => void) | undefined;
  ceiling?: number | undefined;
  grace?: number | undefined;
  clock?: Clock | undefined;
}

/** One book's engine, from the call that started it. */
class Live {
  engine: Engine | undefined;
  stopped = false;
  readonly client: Promise<EngineClient>;

  constructor(
    /** The stamp of its last render. The lowest of these is the coldest book. */
    public used: number,
    stamp: () => number,
    starting: Promise<Engine>,
  ) {
    this.client = starting.then((engine) => {
      // The book was dropped while its worker was starting, so the
      // worker is running for a session nothing is waiting on.
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
  /** The views open on each book, by the book's path. */
  private readonly held = new Map<string, number>();
  /** The grace each book with no view on it is inside, by its path. */
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

  /** Books kept on the engine at once. */
  get ceiling(): number {
    return this.limit;
  }

  /** Sets the ceiling, stopping the coldest books down to the new one. */
  set ceiling(books: number) {
    this.limit = capped(books);
    this.evict(0);
  }

  /**
   * The engine this book is set on, started if it is not running. A
   * second call while the first is starting waits on that one, so an
   * effect that mounts twice starts one worker.
   *
   * The client is the one running now. A caller that keeps it past the
   * render it asked for asks again rather than holding it.
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
    // A worker that will not start is not kept, so the next open starts
    // one rather than handing back the failure for orca's life.
    live.client.catch(() => {
      if (this.live.get(book) === live) this.live.delete(book);
    });
    return live.client;
  }

  /**
   * A view on this book. The engine outlives the view, so dropping the
   * last hold starts the grace rather than stopping the book, and a
   * view opened inside the grace keeps the book where it is.
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

  /** Stops this book's engine, and tells the owner it is gone. */
  stop(book: string): void {
    const live = this.live.get(book);
    if (live === undefined) return;
    this.live.delete(book);
    this.unwait(book);
    live.stop();
    this.pooling.gone?.(book);
  }

  /** Stops every engine, for a plugin being unloaded. */
  close(): void {
    this.closed = true;
    for (const book of [...this.live.keys()]) this.stop(book);
    for (const book of [...this.waiting.keys()]) this.unwait(book);
    this.held.clear();
  }

  private stamp(): number {
    return (this.used += 1);
  }

  /** Stops the coldest books until `room` more fit under the ceiling. */
  private evict(room: number): void {
    while (this.live.size + room > this.limit) {
      const entries = [...this.live.entries()];
      const coldest = entries.reduce((cold, entry) =>
        entry[1].used < cold[1].used ? entry : cold,
      );
      this.stop(coldest[0]);
    }
  }

  /** Starts the grace this book is stopped after. */
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

/** A client whose renders stamp the book they ran for. */
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

/** A ceiling of at least one book, in whole books. */
function capped(books: number): number {
  return Number.isFinite(books) ? Math.max(1, Math.floor(books)) : CEILING;
}
