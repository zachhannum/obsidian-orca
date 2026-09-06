import {
  faceFamily,
  type Asset,
  type Client,
  type FaceAttributes,
  type FontRefEntry,
  type LayoutOutput,
  type Op,
  type Page,
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

/** One page of the book, and the tables a painter reads it through. */
export interface Reading {
  /** The page's place in the book, counting from 0. */
  at: number;
  page: Page;
  /** The book's length in pages. */
  pages: number;
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
  private readonly held = new Map<number, Page>();
  /** The generation {@link Session.held} holds pages from. */
  private heldAt = -1;
  /** The window fetches in flight, by the page each one starts at. */
  private readonly fetching = new Map<number, Promise<void>>();

  constructor(
    private readonly client: EngineClient,
    private readonly faces: FaceSet,
  ) {}

  /** Nothing until the first render lands. */
  get output(): LayoutOutput | undefined {
    return this.layout;
  }

  /** The book's length in pages, as the last reply counted it. */
  get pages(): number {
    return this.layout?.bookPages ?? 0;
  }

  /** The generation of the last render. */
  get generation(): number {
    return this.client.current;
  }

  get stages(): Stages {
    return this.client.stages;
  }

  /**
   * Lays the book out once. A second view, or the same one opened
   * again, paints the pages this already has.
   */
  async open(ops: Op[]): Promise<void> {
    this.opening ??= this.lay(ops).catch((cause: unknown) => {
      this.opening = undefined;
      throw cause;
    });
    await this.opening;
  }

  /**
   * The book as PDF bytes, from the session the pages were laid out
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
   * The page at `at`, counting from 0, with the pages either side of it
   * asked for alongside, so the next turn paints without a round trip.
   * A book too short for `at` reads its last page rather than none.
   */
  async read(at: number): Promise<Reading | undefined> {
    if (this.layout === undefined) return undefined;
    this.drop();
    // Held or not, the window around the page is asked for. Only a page
    // that is not held waits on the answer.
    const wanted = this.bound(at);
    if (this.held.has(wanted)) this.spare(wanted);
    else await this.fill(wanted);
    // A reply says how long the book is now, and a book that got
    // shorter lands on its last page rather than past the end.
    const index = this.bound(at);
    if (!this.held.has(index)) await this.fill(index);
    const page = this.held.get(index);
    const layout = this.layout;
    if (page === undefined || layout === undefined) return undefined;
    return {
      at: index,
      page,
      pages: layout.bookPages,
      fonts: layout.fonts,
      assets: layout.assets,
    };
  }

  /** `at`, held inside the book. */
  private bound(at: number): number {
    return Math.min(Math.max(at, 0), Math.max(this.pages - 1, 0));
  }

  /** Empties the cache of pages from before the last edit. */
  private drop(): void {
    const at = this.client.current;
    if (at === this.heldAt) return;
    this.held.clear();
    this.heldAt = at;
  }

  /**
   * Fetches whatever of the window around `at` is not held yet, as one
   * range. A window already held costs nothing.
   */
  private fill(at: number): Promise<void> {
    const from = Math.max(at - NEIGHBOURS, 0);
    const to = Math.min(at + NEIGHBOURS, this.pages - 1);
    let first = -1;
    let last = -1;
    for (let page = from; page <= to; page += 1) {
      if (this.held.has(page)) continue;
      if (first < 0) first = page;
      last = page;
    }
    if (first < 0) return Promise.resolve();
    const running = this.fetching.get(first);
    if (running !== undefined) return running;
    const fetch = this.take({ first, count: last - first + 1 }).finally(() => {
      this.fetching.delete(first);
    });
    this.fetching.set(first, fetch);
    return fetch;
  }

  /** The same, for a turn that has its page already and only wants the rest. */
  private spare(at: number): void {
    // A neighbour that never arrives is fetched again by the turn onto
    // it, so nothing here is worth reporting.
    void this.fill(at).catch(() => undefined);
  }

  private async lay(ops: Op[]): Promise<void> {
    const layout = await routed(() =>
      this.client.preview(ops, { first: 0, count: 1 + NEIGHBOURS }),
    );
    if (layout === null) return;
    this.heldAt = this.client.current;
    this.keep(layout);
    await this.load(layout);
  }

  /** Asks for one window and keeps what comes back. */
  private async take(range: Range): Promise<void> {
    const asked = this.client.current;
    const layout = await routed(() => this.client.preview([], range));
    // An edit that landed while the range was out has already dropped
    // the pages this answers with.
    if (layout === null || this.client.current !== asked) return;
    this.keep(layout);
    await this.load(layout);
  }

  /** Holds a reply's pages at the places in the book it says they are. */
  private keep(layout: LayoutOutput): void {
    this.layout = layout;
    for (const [offset, page] of layout.pages.entries()) {
      this.held.set(layout.first + offset, page);
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
      await this.faces.add(faceFamily(id), bytes, entry.attributes);
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
