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
import { bookCss } from "@/book/css";
import type { Links } from "@/book/links";
import type { Model } from "@/book/model";
import { sectionIds } from "@/book/names";
import { BookError } from "@/book/note";
import { entryName, resolve, type Section } from "@/book/order";
import { sourceNamed } from "@/book/pages";
import { writtenByte } from "@/book/place";
import {
  bookImages,
  sendBook,
  sendEdit,
  sendFaces,
  type Edit,
  type Face,
  type Image,
  type Loaded,
  type Unread,
} from "@/book/plan";
import { Loop, timers, type Clock } from "@/engine/loop";
import type { Engines } from "@/engine/pool";
import { Session, type FaceSet } from "@/engine/session";
import { designFonts, designUses, useKey, type Design, type FontUse } from "@/style/design";
import type { Registered } from "@/style/faces";
import type { RuleFrom, Setting } from "@/style/generated";
import type { Place } from "@/style/origin";
import { designOverridden, type Override } from "@/style/overrides";
import { OWN_SHEET, designRuleAt, designSheets } from "@/style/sheet";
import type { ResolvedUse } from "@/ui/fonts";
import { bookName } from "@/ui/shelf";

/** A font and variant the design sets that registered no face. */
export interface Unloaded {
  use: FontUse;
  /** True when the font was found and its files would not read. */
  unread: boolean;
}

/** The book, as much of it as crosses from the engine that died onto its next one. */
export interface Replay {
  /** The text each note last crossed as, which is newer than the note on disk. */
  sent: Map<string, string>;
  /** The design its sheets were generated from. */
  design: Design;
  /** The author's own CSS, which may be newer than the note's fence. */
  css: string;
  /** The order and the names those sheets were generated against. */
  setting: Setting;
  /** The sheets it was styled with, in cascade order. */
  sheets: readonly Sheet[];
}

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
  /** The book note this was set from, which is where its design is written. */
  readonly path: string;
  /** Its sections, in reading order. */
  readonly sections: Section[];
  /** The language it sets. The engine hyphenates with the patterns for it. */
  readonly language: string | undefined;
  /** The fonts and images this book has put on the wire, by content hash. */
  readonly assets: Registry;

  private readonly loop: Loop;
  private readonly watchers = new Set<() => void>();
  private readonly sent: Map<string, string>;
  private readonly links: Links;
  /** The order and the names the generated layer was counted against. */
  private readonly setting: Setting;
  /** The embeds the retypes so far started, chained so they run in order. */
  private embedding: Promise<void> = Promise.resolve();
  /** The embeds started and not yet resolved. */
  private embeds = 0;
  private loaded: Loaded;
  private designed: Design;
  /** The fonts and variants the faces sheet registers, one for each use the design sets. */
  private registered: Registered[];
  /** The uses whose font files would not read, by their key. */
  private readonly unreadFaces = new Set<string>();
  /** The embeds each note has that brought no bytes, by the note's path. */
  private readonly unreadIn = new Map<string, Unread[]>();
  private own: string;
  /** The author's CSS as the last render that landed set it. */
  private linted: string;
  private gone = false;

  constructor(
    book: {
      name: string;
      /** The book note this was set from. */
      path: string;
      session: Session;
      sections: Section[];
      /** The language the book sets, from its own properties. */
      language: string | undefined;
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
      /** The faces the sheets register, for the uses the design sets. */
      registered: Registered[];
      /** Each use the design sets as it resolved, loaded or not. */
      resolved?: readonly ResolvedUse[];
      /** The images that crossed. */
      images?: readonly Image[];
      /** The embeds that brought no bytes. */
      unread?: readonly Unread[];
      /** The author's own CSS, the last of the sheets. */
      css: string;
      /** The order and the names the sheets were generated against. */
      setting: Setting;
    },
    clock: Clock,
  ) {
    this.own = book.css;
    this.linted = book.css;
    this.name = book.name;
    this.path = book.path;
    this.session = book.session;
    this.sections = book.sections;
    this.language = book.language;
    this.sent = book.sent;
    this.assets = book.assets;
    this.links = book.links;
    this.loaded = { sheets: book.sheets };
    this.designed = book.design;
    this.registered = book.registered;
    for (const each of book.resolved ?? []) {
      if (each.unread) this.unreadFaces.add(useKey(each.use));
    }
    for (const at of book.unread ?? []) {
      this.unreadIn.set(at.note, [...(this.unreadIn.get(at.note) ?? []), at]);
    }
    this.setting = book.setting;
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
    this.embeds += 1;
    // An embed that will not read crosses no bytes, and the engine
    // warns about the url.
    this.embedding = this.embedding
      .then(embedding, embedding)
      .catch(() => undefined)
      .finally(() => {
        this.embeds -= 1;
      });
  }

  /**
   * True when no embed is resolving and the loop has nothing waiting or
   * in flight, so the pages the views last painted are the book as it
   * stands.
   */
  get quiet(): boolean {
    return this.embeds === 0 && this.loop.idle;
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
    const { images: found, unread } = await bookImages(
      [{ name: note, text }],
      this.links,
      (at) => this.assets.take(at),
    );
    this.unreadIn.set(note, unread);
    const fresh = found.filter(
      (image) => this.assets.imageUrl(image.url) === undefined,
    );
    if (fresh.length === 0) return;
    for (const image of fresh) this.assets.image(image.url, image);
    this.plan(`embedded:${note}`, { did: "embedded", images: fresh });
  }

  /** Every font the book's design names, the body's first. None means the theme's own. */
  get fonts(): string[] {
    return designFonts(this.designed);
  }

  /** The design the book is set under, which the book note holds. */
  get design(): Design {
    return this.designed;
  }

  /**
   * The uses the design sets that registered no face, so the PDF has
   * none of theirs to embed. `unread` is set when the font was found
   * and its files would not read.
   */
  get unloaded(): Unloaded[] {
    const held = new Set(this.registered.map(useKey));
    return designUses(this.designed).flatMap((use) => {
      const key = useKey(use);
      return held.has(key) ? [] : [{ use, unread: this.unreadFaces.has(key) }];
    });
  }

  /** The embeds that brought no bytes, by note in the order the notes were read. */
  get unread(): Unread[] {
    return [...this.unreadIn.values()].flat();
  }

  /**
   * Sets the book under a design. It writes the faces sheet and the
   * generated layer again, and crosses any face a use newly resolved.
   * A face crosses the first time a variant is picked and stays
   * registered for the session, so picking it again sends the sheets
   * alone. A use the design no longer sets drops out of the faces sheet.
   *
   * The plan keys an edit that carries faces by those faces. A later
   * edit coalesces with it, so the faces still cross.
   */
  restyle(design: Design, resolved: readonly ResolvedUse[] = []): void {
    this.designed = design;
    const held = new Map(this.registered.map((each) => [useKey(each), each]));
    for (const each of resolved) {
      const key = useKey(each.use);
      if (each.registered === undefined) held.delete(key);
      else held.set(key, each.registered);
      if (each.unread) this.unreadFaces.add(key);
      else this.unreadFaces.delete(key);
    }
    const uses = new Set(designUses(design).map(useKey));
    this.registered = [...held].flatMap(([key, each]) => (uses.has(key) ? [each] : []));
    const sheets = designSheets(this.designed, this.setting, this.own, this.registered);
    // Only a face not yet sent keys the edit. An edit keyed by faces that
    // already crossed would replace a waiting edit under the same key,
    // and the faces that edit planned would never cross.
    const faces = unique(resolved.flatMap((each) => each.faces)).filter(
      (face) => !this.assets.sent(face.key),
    );
    if (faces.length === 0) {
      this.plan("styled", { did: "styled", sheets });
      return;
    }
    this.plan(`fonted:${faces.map((face) => face.key).join(" ")}`, {
      did: "fonted",
      faces,
      sheets,
    });
  }

  /** The origin of the design sheet's rule that spans a line, counted from 1. */
  ruleAt(line: number): RuleFrom | undefined {
    return designRuleAt(this.designed, this.setting, line, this.registered);
  }

  /**
   * The design keys the author's CSS beats, each with the declaration
   * that beats it. A refused declaration beats nothing.
   */
  overridden(refused: readonly Place[]): ReadonlyMap<string, Override> {
    return designOverridden(this.designed, this.setting, this.own, this.registered, refused);
  }

  /** The author's own CSS the book is set under, which the note's fence holds. */
  get css(): string {
    return this.own;
  }

  /**
   * The author's CSS the session's warnings are against. It trails
   * {@link Typeset.css} while a render of newer CSS is on its way.
   */
  get cssWarned(): string {
    return this.linted;
  }

  /** Sets the book under the author's own CSS, which crosses last of the sheets. */
  recss(css: string): void {
    if (css === this.own) return;
    this.own = css;
    this.restyle(this.designed);
  }

  /** The text a note last crossed as. The engine counts its byte offsets in this text. */
  textOf(note: string): string | undefined {
    return this.sent.get(note);
  }

  /** Told once a render has landed, so a view repaints where it left off. */
  watch(painted: () => void): () => void {
    this.watchers.add(painted);
    return () => {
      this.watchers.delete(painted);
    };
  }

  /**
   * Whether the engine of this book stopped. A view that reads the book
   * then sets it again rather than reads a session that is gone.
   */
  get dropped(): boolean {
    return this.gone;
  }

  /**
   * Everything this book needs to be set again on another engine. The
   * words come from what crossed rather than from the vault. A chapter
   * typed but not yet saved is set as the author has it.
   */
  get replay(): Replay {
    return {
      sent: new Map(this.sent),
      design: this.designed,
      css: this.own,
      setting: this.setting,
      sheets: this.loaded.sheets,
    };
  }

  /** Drops the wait, for a book orca is no longer keeping up to date. */
  stop(): void {
    this.loop.stop();
    this.assets.close();
  }

  /** Drops the book after its engine stops. */
  drop(): void {
    this.gone = true;
    this.stop();
  }

  /**
   * Drops the book after its engine died, and tells the views to set it
   * again. A book orca stopped waits for a reader to turn a page. One
   * that died is put back now, on the page the reader was on.
   */
  died(): void {
    this.drop();
    for (const painted of this.watchers) painted();
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
    const own = ops
      .flatMap((op) => (op.op === "style" ? op.sheets : []))
      .filter((sheet) => sheet.name === OWN_SHEET)
      .at(-1);
    await this.session.render(ops);
    if (own !== undefined) this.linted = own.css;
    for (const painted of this.watchers) painted();
  }
}

/** One report from a book being set. */
export interface Progress {
  name: string;
  /** Whether this is the book being set again, after its engine died. */
  again: boolean;
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
  /** The faces and rules of each font and variant, for a book being set in the ones it already had. */
  fonts(uses: readonly FontUse[]): Promise<readonly ResolvedUse[]>;
  /** The vault's own files, which the asset registry reads and hashes. */
  files: VaultAdapter;
  links: Links;
  /** The engines orca runs, one per book. */
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
  /** The replay each book that died left behind, by its path. */
  private readonly again = new Map<string, Replay>();

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
    const carried = this.again.get(path);
    this.again.delete(path);
    // A reader opening a book that stopped is asking for another try.
    // Orca sets a book again after a death. Asking a third time is the
    // reader's own call rather than orca's.
    if (carried === undefined) this.vault.engines.retry(path);
    const composing = this.compose(path, opening, carried);
    this.books.set(path, composing);
    // A run that fails is not kept, so the next open typesets the book
    // again rather than handing back the failure for the session's life.
    composing.catch(() => {
      if (this.books.get(path) === composing) this.books.delete(path);
    });
    return composing;
  }

  /**
   * Holds this book while a view on it is open. The engine of the book
   * outlives the view, and stops one grace after the last hold drops.
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
    this.release(path, (book) => {
      book.stop();
    });
  }

  /**
   * Drops a book after its engine stops. The next open sets the book on
   * a new engine, and the view sets the book again rather than goes on
   * with the pages it holds.
   */
  discard(path: string): void {
    this.release(path, (book) => {
      book.drop();
    });
  }

  /**
   * Drops a book whose engine died, and sets it again now. What the
   * dead engine was sent crosses to the new one. The book that comes
   * back is the book the author has, not the book the vault has.
   */
  died(path: string): void {
    this.release(path, (book) => {
      this.again.set(path, book.replay);
      book.died();
    });
  }

  private release(path: string, dropped: (book: Typeset) => void): void {
    const existing = this.books.get(path);
    this.books.delete(path);
    void existing?.then(dropped, () => undefined);
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

  private async compose(
    path: string,
    opening: Opening,
    carried: Replay | undefined,
  ): Promise<Typeset> {
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
      again: carried !== undefined,
      read,
      of: present.length,
      opening: from === undefined ? undefined : entryName(from.entry),
    };
    opening.told?.(progress);

    const sent = new Map<string, string>();
    const assets = new Registry(this.vault.files);
    const { ops, images, unread } = await sendBook(
      model.book,
      model.order,
      this.vault.links,
      path,
      async (at) => {
        // A note the dead engine was sent crosses as it was sent. The
        // author may have typed since the vault last held it.
        const text = carried?.sent.get(at) ?? (await this.vault.read(at));
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
    const design: Design = carried?.design ?? model.book.design;
    const { title, author, publisher, language } = model.book.metadata;
    const setting: Setting = carried?.setting ?? {
      sections: sectionIds(sections),
      title,
      author,
      publisher,
    };
    const css = carried?.css ?? bookCss(model.order);
    const resolved = await this.resolve(designUses(design));
    const registered = resolved.flatMap((each) => each.registered ?? []);
    const sheets = [
      ...(carried?.sheets ?? designSheets(design, setting, css, registered)),
    ];
    // The sheets name the fonts, and a new engine has none of their
    // faces, so they cross ahead of the sheets that ask for them.
    const faces = unique(resolved.flatMap((each) => each.faces));
    for (const face of faces) assets.crossed(face.key);
    await session.open([...ops, ...sendFaces(faces), styleOp(sheets)]);
    return new Typeset(
      {
        name,
        path,
        session,
        sections,
        language,
        sheets,
        sent,
        assets,
        links: this.vault.links,
        design,
        registered,
        resolved,
        images,
        unread,
        css,
        setting,
      },
      this.clock,
    );
  }

  /**
   * The faces of each font and variant a book is set in. A font the
   * machine no longer has crosses nothing, and the engine sets its text
   * in the one it carries.
   */
  private async resolve(uses: readonly FontUse[]): Promise<readonly ResolvedUse[]> {
    if (uses.length === 0) return [];
    try {
      return await this.vault.fonts(uses);
    } catch {
      return [];
    }
  }
}

/** Each face once, by its key, in the order first seen. */
function unique(faces: readonly Face[]): Face[] {
  const kept = new Map<string, Face>();
  for (const face of faces) if (!kept.has(face.key)) kept.set(face.key, face);
  return [...kept.values()];
}
