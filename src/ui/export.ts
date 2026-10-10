/**
 * The export dialog's modal. It owns the React root under its content,
 * and asks the session that drew the preview for the file.
 */

import { Modal, type App } from "obsidian";
import type { VaultAdapter } from "@/assets/vault";
import { exportPath, exportName } from "@/book/export";
import type { BookMetadata } from "@/book/note";
import type { Place } from "@/style/origin";
import { TARGETS } from "@/engine/export";
import { EngineError } from "@/engine/errors";
import type { Composer, Typeset } from "@/ui/composer";
import { chooseDiskFolder, desktopSink, onDesktop } from "@/ui/desktop";
import { mountExport, type Exporter, type Mounted } from "@/ui/exporting";
import { preflight } from "@/ui/preflight";
import { sharer } from "@/ui/share";
import { docks } from "@/ui/sheet";

/** The plugin, as much of it as an export reaches. */
export interface Exports {
  composer: Composer;
  /** The book note's path. */
  book: string;
  files: VaultAdapter;
  metadata(): Promise<BookMetadata | undefined>;
  /** Opens the design panel, where a face is picked. */
  openPanel(): void;
  /** Opens the navigator on this book, at one entry of its reading order. */
  locate(at: number): void;
  /** Opens the place a warning named: a note, or the author's CSS. */
  opens(route: "note" | "css", place: Place): void;
  /** Opens the book's preview with its warnings showing. */
  openIssues(): void;
  /** Opens the book's preview at one page, by its place in the book from 0. */
  openPage(at: number): void;
}

/** The media type the share sheet is told for each format, by the target's id. */
const MEDIA: Record<string, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
};

function mediaOf(id: string): string {
  return MEDIA[id] ?? "application/octet-stream";
}

class ExportModal extends Modal {
  private mounted: Mounted | undefined;
  private release: (() => void) | undefined;

  constructor(
    app: App,
    private readonly exports: Exports,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.dataset["testid"] = "orca-export";
    this.modalEl.addClass("orca-export-modal");
    docks(this, "Export book");
    const { composer, book } = this.exports;
    // The dialog holds the book, so its engine does not stop under an export.
    this.release = composer.hold(book);
    this.mounted = mountExport(this.contentEl, this.modalEl, this.exporter());
  }

  override onClose(): void {
    this.mounted?.unmount();
    this.mounted = undefined;
    this.release?.();
    this.release = undefined;
  }

  /**
   * The book the preview already set. A book no view has open is set
   * through the composer, which the preview then reads too.
   */
  private typeset(): Promise<Typeset> {
    return this.exports.composer.reading(this.exports.book);
  }

  private exporter(): Exporter {
    const { book, files } = this.exports;
    const { workspace } = this.app;
    // The desktop app has a path on disk to offer instead.
    const sheet = onDesktop() ? undefined : sharer(navigator);
    return {
      formats: TARGETS,
      prepare: async () => {
        const metadata = (await this.exports.metadata()) ?? {};
        return { name: exportName(metadata), path: exportPath(book, metadata) };
      },
      check: async () => {
        const typeset = await this.typeset();
        await typeset.resolving;
        return preflight({
          design: typeset.design,
          sections: typeset.sections,
          unloaded: typeset.unloaded,
          unread: typeset.unread,
          warnings: typeset.session.warnings,
          pages: (await typeset.session.outline()) ?? [],
        });
      },
      watch: (changed) => {
        let unwatch: (() => void) | undefined;
        let stopped = false;
        void this.typeset().then(
          (typeset) => {
            if (!stopped) unwatch = typeset.watch(changed);
          },
          () => undefined,
        );
        return () => {
          stopped = true;
          unwatch?.();
        };
      },
      // Obsidian mobile has no path outside the vault to write to.
      ...(onDesktop() ? { choose: () => chooseDiskFolder() } : {}),
      write: async (destination, format) => {
        const typeset = await this.typeset();
        const sink = desktopSink(files);
        return format.run(typeset.session, (bytes) => sink.write(destination, bytes));
      },
      keep: (destination, bytes) => desktopSink(files).write(destination, bytes),
      ...(sheet === undefined || !sheet.takes(mediaOf("pdf"))
        ? {}
        : {
            share: {
              takes: (format) => sheet.takes(mediaOf(format.id)),
              make: async (name, format) => {
                const typeset = await this.typeset();
                let held: Uint8Array | undefined;
                const result = await format.run(typeset.session, (bytes) => {
                  held = bytes;
                  return Promise.resolve();
                });
                if (held === undefined) throw new EngineError(`${format.label} made no file`);
                const file = `${name}.${format.extension}`;
                return { file: { name: file, type: mediaOf(format.id), bytes: held }, result };
              },
              hand: (files) => sheet.share(files),
            },
          }),
      open: (path) => {
        void workspace.openLinkText(path, "", true);
      },
      fix: (blocker) => {
        this.close();
        if (blocker.row !== undefined) {
          this.exports.locate(blocker.row);
          return;
        }
        if (blocker.at === undefined) {
          this.exports.openPanel();
          return;
        }
        void workspace.openLinkText(blocker.at.note, "", false, {
          eState: { line: blocker.at.line },
        });
      },
      warned: (caution) => {
        this.close();
        if (caution.at === undefined) this.exports.openIssues();
        else if (caution.at.route === "page") this.exports.openPage(caution.at.page);
        else this.exports.opens(caution.at.route, caution.at.place);
      },
      close: () => {
        this.close();
      },
    };
  }
}

/** Opens the export dialog on a book. */
export function openExport(app: App, exports: Exports): void {
  new ExportModal(app, exports).open();
}
