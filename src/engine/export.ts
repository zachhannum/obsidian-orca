import type { Session } from "@/engine/session";

/** One export, counted when its bytes have gone to the sink. */
export interface ExportResult {
  /** The length of the file, in bytes. */
  bytes: number;
  /**
   * The book's length in pages, as the session that drew the preview
   * counts it. It is not read back out of the file.
   */
  leaves: number;
}

/**
 * A format the book exports to. This is a contract between the engine
 * and the modules that offer an export: `ui` lists targets by `label`
 * and names the file with `extension`, and `run` is the only part that
 * talks to the engine.
 *
 * `run` exports from the session that already typeset the pages. It
 * sends no ops and runs no layout stage, so the file is the book the
 * preview shows. The sink is where the bytes go, and the engine does
 * not know what it is. A failed export throws `EngineError` and never
 * calls the sink.
 */
export interface ExportTarget<Options> {
  id: string;
  label: string;
  extension: string;
  options: Options;
  run(
    session: Session,
    sink: (bytes: Uint8Array) => Promise<void>,
  ): Promise<ExportResult>;
}

export const pdfTarget: ExportTarget<Record<string, never>> = {
  id: "pdf",
  label: "PDF",
  extension: "pdf",
  options: {},
  async run(session, sink) {
    const bytes = await session.pdf();
    await sink(bytes);
    return { bytes: bytes.byteLength, leaves: session.pages };
  },
};
