import {
  faceFamily,
  type FaceAttributes,
  type LayoutOutput,
  type Op,
} from "fleuron";
import { EngineError } from "@/engine/errors";

/** The cost of a render, in stage runs. */
export interface Stages {
  style: number;
  lines: number;
  flow: number;
  paint: number;
}

/** The half of fleuron's client a session uses. */
export interface EngineClient {
  preview(ops?: Op[]): Promise<LayoutOutput | null>;
  exportPdf(ops?: Op[]): Promise<Uint8Array | null>;
  fontBytes(font: number): Promise<Uint8Array>;
  readonly current: number;
  readonly stages: Stages;
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

/**
 * One book on the engine. It outlives the views that paint from it, so
 * a leaf that closes and opens again costs no second layout.
 */
export class Session {
  private layout: LayoutOutput | undefined;
  private opening: Promise<void> | undefined;
  private readonly loaded = new Set<number>();

  constructor(
    private readonly client: EngineClient,
    private readonly faces: FaceSet,
  ) {}

  /** Nothing until the first render lands. */
  get output(): LayoutOutput | undefined {
    return this.layout;
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

  private async lay(ops: Op[]): Promise<void> {
    const layout = await routed(() => this.client.preview(ops));
    if (layout === null) return;
    this.layout = layout;
    await this.load(layout);
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
