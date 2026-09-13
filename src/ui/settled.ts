import { SETTLE, timers, type Clock } from "@/ui/writer";

/**
 * The author's CSS on its way to the note. The engine gets every
 * keystroke, and the note gets the last of a burst once the typing
 * stops, so a line typed is one write rather than one per key. CSS for
 * another book first writes the one still waiting.
 */
export class Settled {
  private waiting: { book: string; css: string } | undefined;
  private cancel: (() => void) | undefined;

  constructor(
    private readonly save: (book: string, css: string) => void,
    private readonly clock: Clock = timers,
    private readonly settle: number = SETTLE,
  ) {}

  /** The book's CSS as the author has it now, written on settle. */
  put(book: string, css: string): void {
    if (this.waiting !== undefined && this.waiting.book !== book) this.flush();
    this.waiting = { book, css };
    this.cancel?.();
    this.cancel = this.clock.after(this.settle, () => {
      this.flush();
    });
  }

  /** Writes the CSS still waiting now rather than on settle. */
  flush(): void {
    this.cancel?.();
    this.cancel = undefined;
    const waiting = this.waiting;
    this.waiting = undefined;
    if (waiting !== undefined) this.save(waiting.book, waiting.css);
  }
}
