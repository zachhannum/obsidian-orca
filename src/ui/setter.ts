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
import { entryName, resolve, type Section } from "@/book/order";
import { pageRanges, type Range } from "@/book/pages";
import { sendBook } from "@/book/plan";
import { BookError } from "@/book/note";
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

/** A book being set, as the author waiting on it is told about it. */
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

export class Setter {
  private readonly laid = new Map<string, Promise<Laid>>();
  /** Everyone waiting on a book still being set. */
  private readonly waiting = new Map<string, Set<(at: Progress) => void>>();
  /** The last report from each book being set, so a late arrival sees one. */
  private readonly at = new Map<string, Progress>();

  constructor(private readonly vault: Setting) {}

  /**
   * The book at this path, laid out. A book already set is handed back
   * as it stands, and the second caller on one still setting waits on
   * the same run.
   */
  open(path: string, opening: Opening = {}): Promise<Laid> {
    const told = opening.told;
    if (told !== undefined) {
      const listeners = this.waiting.get(path) ?? new Set();
      listeners.add(told);
      this.waiting.set(path, listeners);
      const reported = this.at.get(path);
      if (reported !== undefined) told(reported);
    }
    const held = this.laid.get(path);
    if (held !== undefined) return held;
    const laying = this.lay(path, opening.note).finally(() => {
      this.waiting.delete(path);
      this.at.delete(path);
    });
    // A run that fails is not kept, so the next open lays the book out
    // again rather than handing back the failure for the session's life.
    this.laid.set(
      path,
      laying.catch((cause: unknown) => {
        this.laid.delete(path);
        throw cause;
      }),
    );
    return laying;
  }

  /** Drops a book, so the next open lays it out from the notes as they are now. */
  forget(path: string): void {
    this.laid.delete(path);
  }

  private async lay(path: string, note: string | undefined): Promise<Laid> {
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
    const opening = sections.find(
      (section) => section.kind === "note" && section.path === note,
    );
    const progress: Progress = {
      name,
      read,
      of: present.length,
      opening: opening === undefined ? undefined : entryName(opening.entry),
    };
    this.tell(path, progress);

    const ops = await sendBook(
      model.book,
      model.order,
      this.vault.links,
      path,
      async (at) => {
        const text = await this.vault.read(at);
        read += 1;
        this.tell(path, { ...progress, read });
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
    const layout = await client.preview([], {
      first: 0,
      count: Math.max(session.pages, 1),
    });
    return pageRanges(sections, layout?.pages ?? []);
  }

  private tell(path: string, progress: Progress): void {
    this.at.set(path, progress);
    for (const listener of this.waiting.get(path) ?? []) listener(progress);
  }
}
