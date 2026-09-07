/**
 * The debounce in front of the engine.
 *
 * A superseded render is one that never started. An edit that lands
 * while the wait is running restarts it, so a burst of keystrokes costs
 * one layout rather than one each, and an edit that lands under a
 * render in flight rides the run after it.
 *
 * Edits coalesce by what they supersede, because the ops orca plans
 * carry the whole of what changed rather than a delta: the second edit
 * to a chapter replaces the first instead of queueing behind it.
 */

import type { Op } from "fleuron";

/** Idle time after the last edit before the render starts, in milliseconds. */
export const COALESCE = 200;

/** The clock the wait runs on. A test hands in one it steps itself. */
export interface Clock {
  /** Runs `fire` after `ms`, and gives back the way to cancel it. */
  after(ms: number, fire: () => void): () => void;
}

/** The clock a plugin runs on. */
export const timers: Clock = {
  after(ms, fire) {
    const timer = setTimeout(fire, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

/** Runs one render, with everything the wait coalesced into it. */
export interface Render {
  (ops: Op[]): Promise<void>;
}

export class Loop {
  /** The ops waiting on the settle, by what each one supersedes. */
  private readonly waiting = new Map<string, Op[]>();
  private cancel: (() => void) | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly render: Render,
    private readonly clock: Clock = timers,
    private readonly wait: number = COALESCE,
  ) {}

  /**
   * One edit. `key` is what it supersedes: a second edit under it
   * replaces the first, and the two cross as one render.
   */
  edit(key: string, ops: Op[]): void {
    this.waiting.set(key, ops);
    this.stop();
    this.cancel = this.clock.after(this.wait, () => {
      this.cancel = undefined;
      void this.run();
    });
  }

  /** The render in flight, for a caller that cannot run under one. */
  get settled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** Drops the wait. What is waiting on it stays waiting. */
  stop(): void {
    this.cancel?.();
    this.cancel = undefined;
  }

  /**
   * One render at a time. The engine holds one document, so a run that
   * starts under another would be answering a book the first one is
   * still changing.
   */
  private run(): Promise<void> {
    const running = this.running;
    // A render with nothing in front of it starts now rather than on a
    // microtask, so the wait is the only thing between a keystroke and
    // the engine.
    const out =
      running === undefined
        ? this.send()
        : running.then(
            () => this.send(),
            () => this.send(),
          );
    const settled = out.then(
      () => undefined,
      () => undefined,
    );
    this.running = settled;
    void settled.then(() => {
      if (this.running === settled) this.running = undefined;
    });
    return settled;
  }

  /** Everything waiting, as the one render that carries it. */
  private async send(): Promise<void> {
    if (this.waiting.size === 0) return;
    const ops = [...this.waiting.values()].flat();
    this.waiting.clear();
    await this.render(ops);
  }
}
