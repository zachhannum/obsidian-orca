/**
 * The books orca has set on the engine.
 *
 * A chapter typeset by itself is a different chapter, so a preview of
 * one is a page of the whole book. The whole book crosses once, its
 * pages come back a window at a time, and where each section landed
 * comes from the same run.
 *
 * A book is typeset once and kept, so the second view of it, and the
 * same one opened again, waits for nothing.
 */

import { styleOp, type Op, type Sheet } from "fleuron";
import { Registry } from "@/assets/registry";
import type { VaultAdapter } from "@/assets/vault";
import type { Links } from "@/book/links";
import type { Model } from "@/book/model";
import { BookError } from "@/book/note";
import { entryName, resolve, type Section } from "@/book/order";
import { pageRanges, type Range } from "@/book/pages";
import {
  sendBook,
  sendEdit,
  type Edit,
  type Face,
  type Loaded,
} from "@/book/plan";
import { Loop, timers, type Clock } from "@/engine/loop";
import { Session, type EngineClient, type FaceSet } from "@/engine/session";
import { designSheets, type Design } from "@/style/design";
import { bookName } from "@/ui/shelf";

/**
 * One book on the engine, and the loop that keeps it up with the notes.
 *
 * An edit is coalesced rather than run: the render that goes out
 * carries the last of a burst of keystrokes, and the views watching are
 * told once it lands. A render that fails leaves the pages already
 * painted where they are.
 */
export class Typeset {
  /** The book's title, or the note's name when it has none. */
  readonly name: string;
  /** Its pages, fetched a window at a time. */
  readonly session: Session;
  /** Its sections, in reading order. */
  readonly sections: Section[];
  /** Every section's folio range, by its place in the reading order. */
  readonly ranges: Map<number, Range>;
  /** The fonts and images this book has put on the wire, by content hash. */
  readonly assets: Registry;

  private readonly loop: Loop;
  private readonly watchers = new Set<() => void>();
  private readonly sent: Map<string, string>;
  private loaded: Loaded;
  /** The design the book is set under, which the next pick replaces. */
  private design: Design;

  constructor(
    book: {
      name: string;
      session: Session;
      sections: Section[];
      ranges: Map<number, Range>;
      /** The sheets the book was set under, which the next plan reads. */
      sheets: Sheet[];
      /** The text each note crossed as, by its vault path. */
      sent: Map<string, string>;
      /** The registry every op path asks before putting bytes on the wire. */
      assets: Registry;
      /** The design the sheets were generated from. */
      design: Design;
    },
    clock: Clock,
  ) {
    this.name = book.name;
    this.session = book.session;
    this.sections = book.sections;
    this.ranges = book.ranges;
    this.sent = book.sent;
    this.assets = book.assets;
    this.loaded = { sheets: book.sheets };
    this.design = book.design;
    this.loop = new Loop((ops) => this.render(ops), clock);
  }

  /**
   * One chapter's words. Text the engine already has is no edit at all,
   * so the note written to disk after the keystrokes that made it sends
   * nothing a second time.
   */
  retype(note: string, text: string): void {
    if (this.sent.get(note) === text) return;
    this.sent.set(note, text);
    this.plan(`typed:${note}`, { did: "typed", name: note, text });
  }

  /** The family the book is set in, or nothing while it is set in the theme's own. */
  get face(): string | undefined {
    return this.design.face;
  }

  /**
   * Sets the book in a family. Every face of it crosses the first time
   * it is picked and stays registered for the session's life, so
   * picking it again sends the sheet alone.
   */
  reface(family: string, faces: readonly Face[]): void {
    this.design = { ...this.design, face: family };
    this.plan(`faced:${family}`, {
      did: "faced",
      faces,
      sheets: designSheets(this.design),
    });
  }

  /** Told once a render has landed, so a view repaints where it left off. */
  watch(painted: () => void): () => void {
    this.watchers.add(painted);
    return () => {
      this.watchers.delete(painted);
    };
  }

  /** Drops the wait, for a book orca is no longer keeping up to date. */
  stop(): void {
    this.loop.stop();
    this.assets.close();
  }

  /**
   * Plans one edit and waits it out. The registry takes down whatever
   * the ops put on the wire, so the next plan sends none of it twice.
   */
  private plan(key: string, edit: Edit): void {
    const planned = sendEdit(edit, this.loaded, this.assets);
    this.loaded = planned.loaded;
    for (const crossed of planned.crossed) this.assets.crossed(crossed);
    this.loop.edit(key, planned.ops);
  }

  private async render(ops: Op[]): Promise<void> {
    await this.session.render(ops);
    for (const painted of this.watchers) painted();
  }
}

/** One report from a book being set. */
export interface Progress {
  name: string;
  /** The sections orca has read on the way to the engine. */
  read: number;
  /** The sections the book has. */
  of: number;
  /** The entry the book will open at, for a toggle that named one. */
  opening: string | undefined;
}

/** The vault and the engine, as much of them as setting a book takes. */
export interface Composing {
  /** The book at this path, or nothing for a note orca refuses. */
  model(path: string): Promise<Model | undefined>;
  /** A note the book reads, by its vault path. */
  read(path: string): Promise<string>;
  /** A note's own name, which titles a book with no title of its own. */
  name(path: string): string;
  /** The vault's own files, which the asset registry reads and hashes. */
  files: VaultAdapter;
  links: Links;
  client: Promise<EngineClient>;
  faces: FaceSet;
}

/** The place a book is asked to open at, and who is told while it sets. */
export interface Opening {
  /** The note the writer came from, if they came from one. */
  note?: string | undefined;
  /** Told what the book is waiting on, until it is set. */
  told?: ((progress: Progress) => void) | undefined;
}

/** The number of times the whole book is asked for before its folios are given up on. */
const ASKS = 3;

export class Composer {
  private readonly books = new Map<string, Promise<Typeset>>();

  constructor(
    private readonly vault: Composing,
    private readonly clock: Clock = timers,
  ) {}

  /**
   * The book at this path, typeset. A book already set, or one still
   * setting, is handed back as it stands, so only the caller that
   * starts a run is told how far along it is.
   */
  open(path: string, opening: Opening = {}): Promise<Typeset> {
    const existing = this.books.get(path);
    if (existing !== undefined) return existing;
    const composing = this.compose(path, opening);
    this.books.set(path, composing);
    // A run that fails is not kept, so the next open typesets the book
    // again rather than handing back the failure for the session's life.
    composing.catch(() => {
      if (this.books.get(path) === composing) this.books.delete(path);
    });
    return composing;
  }

  /**
   * The book at this path, for a caller that reads one rather than
   * opens it. Nothing is typeset here: a surface that only reports on
   * a book cannot be the reason it is set, nor take the report of a
   * caller that is.
   */
  opened(path: string): Promise<Typeset> | undefined {
    return this.books.get(path);
  }

  /** Drops a book, so the next open typesets it from the notes as they are now. */
  forget(path: string): void {
    const existing = this.books.get(path);
    this.books.delete(path);
    void existing?.then(
      (book) => {
        book.stop();
      },
      () => undefined,
    );
  }

  /**
   * One chapter of a book that is set, retyped. A book nothing has
   * opened is untouched: the next open reads the note as it now is.
   */
  retype(book: string, note: string, text: string): void {
    void this.books.get(book)?.then(
      (typeset) => {
        typeset.retype(note, text);
      },
      () => undefined,
    );
  }

  private async compose(path: string, opening: Opening): Promise<Typeset> {
    const model = await this.vault.model(path);
    if (model === undefined) {
      throw new BookError(`${path} is not a book orca reads`);
    }
    const name = bookName({ path, name: this.vault.name(path), model });
    const { sections } = resolve(model.order, this.vault.links, path);
    const present = sections.filter((section) => section.kind !== "missing");
    // A generated section is written here rather than read, so it is
    // done before the count starts.
    let read = present.filter((section) => section.kind === "generated").length;
    const from = sections.find(
      (section) => section.kind === "note" && section.path === opening.note,
    );
    const progress: Progress = {
      name,
      read,
      of: present.length,
      opening: from === undefined ? undefined : entryName(from.entry),
    };
    opening.told?.(progress);

    const sent = new Map<string, string>();
    const ops = await sendBook(
      model.book,
      model.order,
      this.vault.links,
      path,
      async (at) => {
        const text = await this.vault.read(at);
        sent.set(at, text);
        read += 1;
        opening.told?.({ ...progress, read });
        return text;
      },
    );

    const client = await this.vault.client;
    const assets = new Registry(this.vault.files);
    const session = new Session(client, this.vault.faces);
    const design: Design = {};
    const sheets = designSheets(design);
    await session.open([...ops, styleOp(sheets)]);
    const ranges = await this.ranges(client, session, sections);
    return new Typeset(
      { name, session, sections, ranges, sheets, sent, assets, design },
      this.clock,
    );
  }

  /**
   * Every section's folios. The whole book comes back over the wire to
   * answer this, and nothing smaller can: a section's id says where it
   * falls only against every other id in the book.
   */
  private async ranges(
    client: EngineClient,
    session: Session,
    sections: Section[],
  ): Promise<Map<number, Range>> {
    // Another view's render answers before this question does, and the
    // reply that comes back behind it is nothing at all. The book on
    // the engine is the same book, so the question is asked again.
    for (let asked = 0; asked < ASKS; asked += 1) {
      const layout = await client.preview([], {
        first: 0,
        count: Math.max(session.pages, 1),
      });
      if (layout !== null) return pageRanges(sections, layout.pages);
    }
    return new Map();
  }
}
