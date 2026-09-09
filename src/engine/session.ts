import {
  faceFamily,
  type Asset,
  type Client,
  type FaceAttributes,
  type Folios,
  type FontRefEntry,
  type LayoutOutput,
  type NodeSource,
  type Op,
  type Page,
  type Warning,
} from "fleuron";
import { EngineError } from "@/engine/errors";

/**
 * A slice of the book's pages. fleuron does not re-export its own, so
 * this is that one, read off the call that takes it.
 */
export type Range = NonNullable<Parameters<Client["preview"]>[1]>;

/** The cost of a render, in stage runs. */
export interface Stages {
  style: number;
  lines: number;
  flow: number;
  paint: number;
}

/** The half of fleuron's client a session uses. */
export interface EngineClient {
  preview(ops?: Op[], range?: Range): Promise<LayoutOutput | null>;
  exportPdf(ops?: Op[]): Promise<Uint8Array | null>;
  fontBytes(font: number): Promise<Uint8Array>;
  nodeAt(source: string, byte: number): Promise<number | null>;
  sourceOf(node: number): Promise<NodeSource | null>;
  foliosOf(nodes: number[]): Promise<(Folios | null)[]>;
  readonly current: number;
  readonly stages: Stages;
}

/**
 * A client whose renders run one at a time. The engine holds one
 * document, so two callers racing it over the same client would see
 * each other's ops: one view's render can come back superseded by a
 * request the engine applied first but rendered last. Serialized,
 * every render still answers the render it was asked for.
 */
export function serialized(client: EngineClient): EngineClient {
  let queue = Promise.resolve();
  const queued = <T>(run: () => Promise<T>): Promise<T> => {
    const settled = queue.then(run, run);
    queue = settled.then(
      () => undefined,
      () => undefined,
    );
    return settled;
  };
  return {
    preview: (ops, range) => queued(() => client.preview(ops, range)),
    exportPdf: (ops) => queued(() => client.exportPdf(ops)),
    fontBytes: (font) => client.fontBytes(font),
    // A question rather than a render: the engine answers it off the
    // book it holds without taking a turn in the queue.
    nodeAt: (source, byte) => client.nodeAt(source, byte),
    sourceOf: (node) => client.sourceOf(node),
    foliosOf: (nodes) => client.foliosOf(nodes),
    get current(): number {
      return client.current;
    },
    get stages(): Stages {
      return client.stages;
    },
  };
}

/** A document's faces, narrowed to what a session adds to them. */
export interface FaceSet {
  add(
    family: string,
    bytes: Uint8Array,
    attributes: FaceAttributes,
  ): Promise<void>;
}

export function documentFaces(document: Document): FaceSet {
  return {
    add: async (family, bytes, attributes) => {
      // Registered at the slope and weight the face already has, so
      // the browser synthesises neither.
      const face = new FontFace(family, new Uint8Array(bytes), {
        style: attributes.italic ? "italic" : "normal",
        weight: String(attributes.weight),
      });
      await face.load();
      document.fonts.add(face);
    },
  };
}

/** The number of pages either side of the one being read that ride along. */
const NEIGHBOURS = 1;

/** The pages a view paints, and the tables a painter reads them through. */
export interface Reading {
  /** The place in the book the first of them sits at, counting from 0. */
  at: number;
  /** The pages themselves, in reading order. */
  pages: Page[];
  /** The book's length in pages. */
  length: number;
  fonts: FontRefEntry[];
  assets: Asset[];
}

/**
 * One book on the engine. It outlives the views that paint from it, so
 * a leaf that closes and opens again costs no second layout.
 */
export class Session {
  private layout: LayoutOutput | undefined;
  private opening: Promise<void> | undefined;
  private readonly loaded = new Set<number>();
  /** The pages decoded so far, by their place in the book. */
  private readonly cached = new Map<number, Page>();
  /** The generation {@link Session.cached} holds pages from. */
  private cachedAt = -1;
  /** The window fetches in flight, by the range each one asked for. */
  private readonly fetching = new Map<string, Promise<void>>();

  constructor(
    private readonly client: EngineClient,
    private readonly document: FaceSet,
  ) {}

  /** Everything the last run had to complain about. */
  get warnings(): Warning[] {
    return this.layout?.warnings ?? [];
  }

  /** The book's length in pages, as the last reply counted it. */
  get pages(): number {
    return this.layout?.bookPages ?? 0;
  }

  /** Every face the engine registered, indexed by the font id. */
  get faces(): FontRefEntry[] {
    return this.layout?.fonts ?? [];
  }

  /** The generation of the last render. */
  get generation(): number {
    return this.client.current;
  }

  get stages(): Stages {
    return this.client.stages;
  }

  /**
   * Typesets the book once. A second view, or the same one opened
   * again, paints the pages this already has.
   */
  async open(ops: Op[]): Promise<void> {
    this.opening ??= this.typeset(ops).catch((cause: unknown) => {
      this.opening = undefined;
      throw cause;
    });
    await this.opening;
  }

  /**
   * Applies an edit's ops and typesets the book from them, asking for
   * the span the reader is on so the redraw costs one round trip. The
   * pages cached from before the edit go as the reply lands: nothing
   * painted mixes two generations.
   */
  async render(ops: Op[], at = 0, count = 1): Promise<void> {
    // A render that overtook the first layout would be an edit to a
    // book the engine does not have yet.
    await this.opening;
    await this.typeset(ops, at, count);
  }

  /**
   * The node one byte of a note was read into, which is the first step
   * from a cursor to the page it is set on. Nothing where the byte was
   * read into no node: a blank line, or a note the book does not list.
   */
  async nodeAt(source: string, byte: number): Promise<number | undefined> {
    const node = await routed(() => this.client.nodeAt(source, byte));
    return node ?? undefined;
  }

  /**
   * The note a node was read from and the bytes of it the node covers,
   * which is the way back from a run to the manuscript. Nothing for
   * matter the engine wrote itself.
   */
  async sourceOf(node: number): Promise<NodeSource | undefined> {
    const source = await routed(() => this.client.sourceOf(node));
    return source ?? undefined;
  }

  /**
   * The pages each of these nodes' content is set on now, in the order
   * asked about. This is the direction a reflow invalidates, so the
   * answer is asked for when it is wanted and never kept. Nothing for a
   * node the book does not hold, or one whose content reaches no page.
   */
  async foliosOf(nodes: number[]): Promise<(Folios | undefined)[]> {
    const found = await routed(() => this.client.foliosOf(nodes));
    return found.map((folios) => folios ?? undefined);
  }

  /**
   * The book as PDF bytes, from the session the pages were typeset
   * in.
   */
  async pdf(): Promise<Uint8Array> {
    const bytes = await routed(() => this.client.exportPdf());
    if (bytes === null) {
      throw new EngineError(
        "a later render started before the export finished",
      );
    }
    return bytes;
  }

  /**
   * The `count` pages from `at`, counting from 0, with the pages either
   * side of them asked for alongside, so the next turn paints without a
   * round trip. A book too short for the span reads what it has rather
   * than none.
   */
  async read(at: number, count = 1): Promise<Reading | undefined> {
    if (this.layout === undefined) return undefined;
    this.drop();
    // Cached or not, the window around the span is asked for. Only a
    // span that is not cached waits on the answer.
    const wanted = this.bound(at);
    if (this.holds(wanted, count)) this.spare(wanted, count);
    else await this.fill(wanted, count);
    // A reply says how long the book is now, and a book that got
    // shorter lands on its last pages rather than past the end.
    const first = this.bound(at);
    if (!this.holds(first, count)) await this.fill(first, count);
    const layout = this.layout;
    if (layout === undefined) return undefined;
    const pages = this.span(first, count);
    if (pages.length === 0) return undefined;
    this.evict(first, count);
    return {
      at: first,
      pages,
      length: layout.bookPages,
      fonts: layout.fonts,
      assets: layout.assets,
    };
  }

  /** The last page of the span from `at`, clamped to the book. */
  private last(at: number, count: number): number {
    return Math.min(at + count - 1, Math.max(this.pages - 1, 0));
  }

  /** Whether every page of the span from `at` is cached. */
  private holds(at: number, count: number): boolean {
    const last = this.last(at, count);
    for (let page = at; page <= last; page += 1) {
      if (!this.cached.has(page)) return false;
    }
    return true;
  }

  /** The span from `at`, as far as the cached pages run. */
  private span(at: number, count: number): Page[] {
    const pages: Page[] = [];
    const last = this.last(at, count);
    for (let page = at; page <= last; page += 1) {
      const cached = this.cached.get(page);
      if (cached === undefined) break;
      pages.push(cached);
    }
    return pages;
  }

  /** `at`, clamped to the book. */
  private bound(at: number): number {
    return Math.min(Math.max(at, 0), Math.max(this.pages - 1, 0));
  }

  /** Drops the pages the window around the span from `at` has read past. */
  private evict(at: number, count: number): void {
    const from = at - NEIGHBOURS;
    const to = this.last(at, count) + NEIGHBOURS;
    for (const page of this.cached.keys()) {
      if (page < from || page > to) this.cached.delete(page);
    }
  }

  /** Empties the cache of pages from before the last edit. */
  private drop(): void {
    const at = this.client.current;
    if (at === this.cachedAt) return;
    this.cached.clear();
    this.cachedAt = at;
  }

  /**
   * Fetches whatever of the window around the span from `at` is not
   * cached yet, as one range. A window already cached costs nothing.
   */
  private fill(at: number, count: number): Promise<void> {
    const from = Math.max(at - NEIGHBOURS, 0);
    const to = Math.min(this.last(at, count) + NEIGHBOURS, this.pages - 1);
    let first = -1;
    let last = -1;
    for (let page = from; page <= to; page += 1) {
      if (this.cached.has(page)) continue;
      if (first < 0) first = page;
      last = page;
    }
    if (first < 0) return Promise.resolve();
    const range = { first, count: last - first + 1 };
    const key = `${String(first)}:${String(range.count)}`;
    const running = this.fetching.get(key);
    if (running !== undefined) return running;
    const fetch = this.take(range).finally(() => {
      this.fetching.delete(key);
    });
    this.fetching.set(key, fetch);
    return fetch;
  }

  /** The same, for a turn that has its pages already and only wants the rest. */
  private spare(at: number, count: number): void {
    // A neighbour that never arrives is fetched again by the turn onto
    // it, so nothing here is worth reporting.
    void this.fill(at, count).catch(() => undefined);
  }

  private async typeset(ops: Op[], at = 0, count = 1): Promise<void> {
    const first = Math.max(at - NEIGHBOURS, 0);
    const layout = await routed(() =>
      this.client.preview(ops, {
        first,
        count: at - first + count + NEIGHBOURS,
      }),
    );
    if (layout === null) return;
    this.drop();
    this.keep(layout);
    await this.load(layout);
  }

  /** Asks for one window and keeps what comes back. */
  private async take(range: Range): Promise<void> {
    const layout = await routed(() => this.client.preview([], range));
    // A range asked for before an edit answers nothing. One the edit
    // overtook in the queue answers the book the edit made, so the
    // pages from before it go first.
    if (layout === null) return;
    this.drop();
    this.keep(layout);
    await this.load(layout);
  }

  /** Caches a reply's pages at the places in the book it says they are. */
  private keep(layout: LayoutOutput): void {
    this.layout = layout;
    for (const [offset, page] of layout.pages.entries()) {
      this.cached.set(layout.first + offset, page);
    }
  }

  private async load(layout: LayoutOutput): Promise<void> {
    const wanted = new Set<number>();
    for (const page of layout.pages) {
      for (const item of page.items) {
        if (item.kind === "text" && !this.loaded.has(item.fontId)) {
          wanted.add(item.fontId);
        }
      }
    }
    await Promise.all([...wanted].map((id) => this.face(id, layout)));
  }

  /**
   * The bundled face lives inside the module, so its bytes come from
   * the engine rather than a url.
   */
  private async face(id: number, layout: LayoutOutput): Promise<void> {
    const entry = layout.fonts[id];
    if (entry === undefined) return;
    this.loaded.add(id);
    try {
      const bytes = await this.client.fontBytes(id);
      await this.document.add(faceFamily(id), bytes, entry.attributes);
    } catch {
      // A face that will not load falls through the painter's stack, so
      // the page is set in the wrong one rather than left blank.
      this.loaded.delete(id);
    }
  }
}

/** The engine's own message: routed, never re-worded. */
async function routed<T>(ask: () => Promise<T>): Promise<T> {
  try {
    return await ask();
  } catch (cause) {
    throw new EngineError(
      cause instanceof Error ? cause.message : String(cause),
      { cause },
    );
  }
}
