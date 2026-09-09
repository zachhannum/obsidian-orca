/**
 * The books orca has set on the engine.
 *
 * A chapter typeset by itself is a different chapter, so a preview of
 * one is a page of the whole book. The whole book crosses once and its
 * pages come back a window at a time; where a section landed is asked
 * of the engine when it is wanted, because a reflow moves it.
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
import { sourceNamed } from "@/book/pages";
import { writtenByte } from "@/book/place";
import {
  bookImages,
  sendBook,
  sendEdit,
  type Edit,
  type Face,
  type Loaded,
} from "@/book/plan";
import { Loop, timers, type Clock } from "@/engine/loop";
import type { Engines } from "@/engine/pool";
import { Session, type FaceSet } from "@/engine/session";
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
  /** The fonts and images this book has put on the wire, by content hash. */
  readonly assets: Registry;

  private readonly loop: Loop;
  private readonly watchers = new Set<() => void>();
  private readonly sent: Map<string, string>;
  private readonly links: Links;
  /** The embeds the retypes so far started, chained so they run in order. */
  private embedding: Promise<void> = Promise.resolve();
  private loaded: Loaded;
  private design: Design;
  private stopped = false;

  constructor(
    book: {
      name: string;
      session: Session;
      sections: Section[];
      /** The sheets the book was set under, which the next plan reads. */
      sheets: Sheet[];
      /** The text each note crossed as, by its vault path. */
      sent: Map<string, string>;
      /** The registry every op path asks before putting bytes on the wire. */
      assets: Registry;
      /** Resolves the embeds a chapter picks up while it is being drafted. */
      links: Links;
      /** The design the sheets were generated from. */
      design: Design;
    },
    clock: Clock,
  ) {
    this.name = book.name;
    this.session = book.session;
    this.sections = book.sections;
    this.sent = book.sent;
    this.assets = book.assets;
    this.links = book.links;
    this.loaded = { sheets: book.sheets };
    this.design = book.design;
    this.loop = new Loop((ops) => this.render(ops), clock);
  }

  /**
   * The page a section opens on now, counting from 0. The engine is
   * asked where the section's first written byte was set, so the answer
   * is the book as it stands rather than the book it was opened as.
   */
  async opens(at: number): Promise<number | undefined> {
    const source = sourceNamed(this.sections, at);
    if (source === undefined) return undefined;
    const text = this.sent.get(source);
    const node = await this.session.nodeAt(
      source,
      text === undefined ? 0 : writtenByte(text),
    );
    if (node === undefined) return undefined;
    const [folios] = await this.session.foliosOf([node]);
    return folios?.at;
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
    const embedding = (): Promise<void> => this.embed(note, text);
    // An embed that will not read crosses no bytes, and the engine
    // warns about the url.
    this.embedding = this.embedding
      .then(embedding, embedding)
      .catch(() => undefined);
  }

  /**
   * The embeds the retypes so far are still resolving. A caller that
   * has to see every op an edit sends waits on this before stepping the
   * loop.
   */
  get resolving(): Promise<void> {
    return this.embedding;
  }

  /**
   * Sends the images a chapter has picked up since it last crossed.
   * The words go first and the bytes follow, so an image added while
   * drafting is a second render rather than a book opened again.
   */
  private async embed(note: string, text: string): Promise<void> {
    const found = await bookImages([{ name: note, text }], this.links, (at) =>
      this.assets.take(at),
    );
    const fresh = found.filter(
      (image) => this.assets.imageUrl(image.url) === undefined,
    );
    if (fresh.length === 0) return;
    for (const image of fresh) this.assets.image(image.url, image);
    this.plan(`embedded:${note}`, { did: "embedded", images: fresh });
  }

  /** The family the book is set in, or nothing for the theme's face. */
  get face(): string | undefined {
    return this.design.face;
  }

  /**
   * Sets the book in a family. Every face of it crosses the first time
   * the family is picked and stays registered for the session, so a
   * later pick sends the sheet alone.
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

  /**
   * Whether the book was dropped, and the view reading it has to set it
   * again. A book is dropped when its notes have changed under it, and
   * when its engine has stopped to make room for another book.
   */
  get dropped(): boolean {
    return this.stopped;
  }

  /** Drops the wait, for a book orca is no longer keeping up to date. */
  stop(): void {
    this.stopped = true;
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
  /** The engines orca is running, one per book. */
  engines: Engines;
  faces: FaceSet;
}

/** The place a book is asked to open at, and who is told while it sets. */
export interface Opening {
  /** The note the writer came from, if they came from one. */
  note?: string | undefined;
  /** Told what the book is waiting on, until it is set. */
  told?: ((progress: Progress) => void) | undefined;
}

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
   * A view on this book, held while the view is open. The book's engine
   * outlives the view, and is stopped a grace after the last hold on it
   * is dropped.
   */
  hold(path: string): () => void {
    return this.vault.engines.hold(path);
  }

  /**
   * The book already open at this path. Nothing is typeset here, so a
   * surface that only reports on a book does not cause one to be set.
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
    const assets = new Registry(this.vault.files);
    const { ops, images } = await sendBook(
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
      (at) => assets.take(at),
    );
    // The url a page draws an embed from is made from the bytes that
    // crossed, so the preview decodes what the layout was set from.
    for (const image of images) assets.image(image.url, image);

    const client = await this.vault.engines.client(path);
    const session = new Session(client, this.vault.faces);
    const design: Design = {};
    const sheets = designSheets(design);
    await session.open([...ops, styleOp(sheets)]);
    return new Typeset(
      {
        name,
        session,
        sections,
        sheets,
        sent,
        assets,
        links: this.vault.links,
        design,
      },
      this.clock,
    );
  }
}
