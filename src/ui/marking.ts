/**
 * The marks of a book's notes, settled by the engine.
 *
 * A note of a book sets that book. Drawing is not a report on a session
 * another surface opened, because then a chapter would draw its marks
 * or not by which pane the reader visited last.
 */

import type { NodeSource } from "fleuron";
import type { Marking, Settled } from "@/ui/marks";
import { candidates, drawn } from "@/ui/runs";

/** The watch on one book, and the session it is on. */
interface Watch {
  typeset: Read;
  drop: () => void;
}

/** The parse of one note, as the engine read it. */
interface Parsed {
  /** The book the note was drawn from, so a render of it clears this. */
  book: string;
  settled: Settled;
}

/** The engine questions a mark is settled by. */
export interface Parses {
  nodeAt(source: string, byte: number): Promise<number | undefined>;
  sourceOf(node: number): Promise<NodeSource | undefined>;
}

/** A book, as much of it as drawing a note needs. */
export interface Read {
  /** Whether the book was dropped, so the next ask sets it again. */
  readonly dropped: boolean;
  /** The text the engine holds for a note, or nothing for a note it does not. */
  textOf(note: string): string | undefined;
  readonly session: Parses;
  /** Told when a render of this book landed. */
  watch(painted: () => void): () => void;
}

/** The plugin around the marks, as much of it as drawing a note needs. */
export interface Shelved {
  /** The book a note belongs to, or nothing for a note no book lists. */
  member(note: string): string | undefined;
  /**
   * This book, set. Drawing a note is orca's own open rather than the
   * reader's, so it forgives no death the book already left.
   */
  open(book: string): Promise<Read>;
  /** Sends a note's text to the book's engine. */
  retype(book: string, note: string, text: string): void;
  /** Draws every open note of this book again, in both of its views. */
  redrawn(book: string): void;
}

/**
 * The marks every open note takes. One instance per plugin: it holds
 * each note's parse, the books it has set, and the editors waiting on
 * a render.
 */
export class Marks implements Marking {
  /** The parse each note was last drawn from, by the path of the note. */
  private readonly parsed = new Map<string, Parsed>();
  /** The book each watch is on, so a book set again is watched again. */
  private readonly watching = new Map<string, Watch>();
  /** The books that would not set, which are asked about once. */
  private readonly refused = new Set<string>();
  /** Every editor waiting to be told the parse under it moved on. */
  private readonly editors = new Set<() => void>();

  constructor(private readonly shelf: Shelved) {}

  marksNow(note: string, against: string): Settled | undefined {
    const held = this.parsed.get(note);
    return held?.settled.against === against ? held.settled : undefined;
  }

  async marksIn(note: string, against: string): Promise<Settled | undefined> {
    const now = this.marksNow(note, against);
    if (now !== undefined) return now;
    const book = this.shelf.member(note);
    if (book === undefined || this.refused.has(book)) return undefined;
    const typeset = await this.setting(book);
    if (typeset === undefined) return undefined;
    // The engine holds older text, so it is sent. The watch on the
    // book tells the editor when the parse of it lands, which is what
    // bounds an absent answer to one render.
    if (typeset.textOf(note) !== against) {
      this.shelf.retype(book, note, against);
      return undefined;
    }
    const asked = candidates(against);
    const answers = await Promise.all(
      asked.map(async (candidate) => {
        const node = await typeset.session.nodeAt(note, candidate.byte);
        if (node === undefined) return undefined;
        return typeset.session.sourceOf(node);
      }),
    );
    const settled: Settled = { against, marks: drawn(against, asked, answers) };
    this.parsed.set(note, { book, settled });
    return settled;
  }

  watch(_note: string, parsed: () => void): () => void {
    this.editors.add(parsed);
    return () => {
      this.editors.delete(parsed);
    };
  }

  /**
   * Drops every parse and every watch, and asks each open note again.
   * This is how a note whose book changed under it takes the marks of
   * the book it now belongs to.
   */
  clear(): void {
    this.parsed.clear();
    this.refused.clear();
    for (const watch of this.watching.values()) watch.drop();
    this.watching.clear();
    this.told();
  }

  /** Drops every watch, so nothing is told after the plugin unloads. */
  unload(): void {
    for (const watch of this.watching.values()) watch.drop();
    this.watching.clear();
    this.editors.clear();
  }

  /**
   * This book, set, and watched from the ask that set it. A book the
   * ceiling stopped is set again here, so the chips come back.
   */
  private async setting(book: string): Promise<Read | undefined> {
    let typeset: Read;
    try {
      typeset = await this.shelf.open(book);
    } catch {
      // A book that will not set is asked about once. Asking on every
      // keystroke would typeset a refusing book over and over.
      this.refused.add(book);
      return undefined;
    }
    if (typeset.dropped) return undefined;
    // A book set again after it was dropped is a second session, and
    // the watch on the first one hears nothing.
    const held = this.watching.get(book);
    if (held?.typeset !== typeset) {
      held?.drop();
      this.watching.set(book, {
        typeset,
        drop: typeset.watch(() => {
          this.painted(book);
        }),
      });
    }
    return typeset;
  }

  /** A render of this book landed, so every note drawn from it is drawn again. */
  private painted(book: string): void {
    for (const [note, held] of [...this.parsed]) {
      if (held.book === book) this.parsed.delete(note);
    }
    this.told();
    this.shelf.redrawn(book);
  }

  /** Tells every editor to ask again. */
  private told(): void {
    for (const ask of [...this.editors]) ask();
  }
}
