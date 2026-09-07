/**
 * The books orca has set on the engine.
 *
 * A chapter laid out by itself is a different chapter, so a preview of
 * one is a page of the whole book. The whole book crosses once, its
 * pages come back a window at a time, and where each section landed
 * comes from the same run.
 *
 * A book is laid out once and kept, so the second view of it, and the
 * same one opened again, waits for nothing.
 */

import { styleOp } from "fleuron";
import type { Links } from "@/book/links";
import type { Model } from "@/book/model";
import { BookError } from "@/book/note";
import { entryName, resolve, type Section } from "@/book/order";
import { pageRanges, type Range } from "@/book/pages";
import { sendBook } from "@/book/plan";
import { Session, type EngineClient, type FaceSet } from "@/engine/session";
import { BUNDLED_THEME, THEME_SHEET } from "@/style/theme";
import { bookName } from "@/ui/shelf";

/** One book on the engine. */
export interface Laid {
  /** The book's title, or the note's name when it has none. */
  name: string;
  /** Its pages, fetched a window at a time. */
  session: Session;
  /** Its sections, in reading order. */
  sections: Section[];
  /** Every section's folio range, by its place in the reading order. */
  ranges: Map<number, Range>;
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
export interface Setting {
  /** The book at this path, or nothing for a note orca refuses. */
  model(path: string): Promise<Model | undefined>;
  /** A note the book reads, by its vault path. */
  read(path: string): Promise<string>;
  /** A note's own name, which titles a book with no title of its own. */
  name(path: string): string;
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

export class Setter {
  private readonly laid = new Map<string, Promise<Laid>>();

  constructor(private readonly vault: Setting) {}

  /**
   * The book at this path, laid out. A book already set, or one still
   * setting, is handed back as it stands, so only the caller that
   * starts a run is told how far along it is.
   */
  open(path: string, opening: Opening = {}): Promise<Laid> {
    const held = this.laid.get(path);
    if (held !== undefined) return held;
    const laying = this.lay(path, opening);
    this.laid.set(path, laying);
    // A run that fails is not kept, so the next open lays the book out
    // again rather than handing back the failure for the session's life.
    laying.catch(() => {
      if (this.laid.get(path) === laying) this.laid.delete(path);
    });
    return laying;
  }

  /** Drops a book, so the next open lays it out from the notes as they are now. */
  forget(path: string): void {
    this.laid.delete(path);
  }

  private async lay(path: string, opening: Opening): Promise<Laid> {
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

    const ops = await sendBook(
      model.book,
      model.order,
      this.vault.links,
      path,
      async (at) => {
        const text = await this.vault.read(at);
        read += 1;
        opening.told?.({ ...progress, read });
        return text;
      },
    );

    const client = await this.vault.client;
    const session = new Session(client, this.vault.faces);
    await session.open([
      ...ops,
      styleOp([{ name: THEME_SHEET, css: BUNDLED_THEME }]),
    ]);
    const ranges = await this.ranges(client, session, sections);
    return { name, session, sections, ranges };
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
