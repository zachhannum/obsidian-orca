/**
 * The one writer on a book note.
 *
 * The view repaints from its model and the note is written once the
 * edits stop, so a control dragged across forty values leaves one
 * revision rather than forty. A change on disk reloads a view with no
 * unwritten edit. A view with one asks the author which version to
 * keep.
 */

import type { Model } from "@/book/model";

/** How long the edits stop for before the note is written, in milliseconds. */
export const SETTLE = 1000;

/** What an edit is painted onto now, and written to on settle. */
export interface Writing {
  /** The model, every time it changes, with how many times it has changed. */
  paint(model: Model, generation: number): void;
  /** The settled model, written to the note. */
  save(model: Model): Promise<void>;
}

/** What runs the settle. A test hands in one it steps itself. */
export interface Clock {
  /** Runs `fire` after `ms`, and gives back the way to cancel it. */
  after(ms: number, fire: () => void): () => void;
}

/** What a change on disk means for the view the note is open in. */
export type Arrival = "reload" | "ask";

/** The clock a view runs on. */
export const timers: Clock = {
  after(ms, fire) {
    const timer = setTimeout(fire, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

export class Writer {
  private held: Model;
  private painted = 0;
  private behind = false;
  private cancel: (() => void) | undefined;
  private writing: Promise<void> | undefined;

  constructor(
    model: Model,
    private readonly to: Writing,
    private readonly clock: Clock = timers,
    private readonly settle: number = SETTLE,
  ) {
    this.held = model;
  }

  /** The view's book, the edits waiting on the settle included. */
  get model(): Model {
    return this.held;
  }

  /** How many times the model has changed since the note was opened. */
  get generation(): number {
    return this.painted;
  }

  /** Whether the note is behind the model. */
  get dirty(): boolean {
    return this.behind;
  }

  /** One edit: painted now, and written on settle. */
  edit(change: (model: Model) => Model): void {
    this.held = change(this.held);
    this.painted += 1;
    this.behind = true;
    this.to.paint(this.held, this.painted);
    this.restart();
  }

  /** Writes the note now rather than on settle. */
  async flush(): Promise<void> {
    this.stop();
    await this.write();
  }

  arrived(): Arrival {
    return this.behind ? "ask" : "reload";
  }

  /**
   * The book now in the note, painted as the model. An unwritten edit
   * is dropped.
   */
  take(model: Model): void {
    this.stop();
    this.held = model;
    this.behind = false;
    this.painted += 1;
    this.to.paint(this.held, this.painted);
  }

  /** Stops the settle. The model stays unwritten. */
  stop(): void {
    this.cancel?.();
    this.cancel = undefined;
  }

  private restart(): void {
    this.stop();
    this.cancel = this.clock.after(this.settle, () => {
      void this.write();
    });
  }

  /**
   * One save at a time. A settle that comes due while a save is
   * running waits for it, so two writes cannot cross on the note.
   */
  private async write(): Promise<void> {
    if (!this.behind) return;
    const written = this.held;
    const out = (this.writing ?? Promise.resolve()).then(() =>
      this.to.save(written),
    );
    this.writing = out.catch(() => undefined);
    await out;
    if (this.held === written) this.behind = false;
  }
}
