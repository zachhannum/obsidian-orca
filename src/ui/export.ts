/**
 * The export dialog's modal. It owns the React root under its content,
 * and asks the session that drew the preview for the PDF.
 */

import { Modal, type App } from "obsidian";
import type { VaultAdapter } from "@/assets/vault";
import { exportPath, exportName } from "@/book/export";
import type { BookMetadata } from "@/book/note";
import { pdfTarget } from "@/engine/export";
import type { Composer, Typeset } from "@/ui/composer";
import { chooseDiskPath, desktopSink } from "@/ui/desktop";
import { mountExport, type Exporter, type Mounted } from "@/ui/exporting";
import { preflight } from "@/ui/preflight";

/** The plugin, as much of it as an export reaches. */
export interface Exports {
  composer: Composer;
  /** The book note's path. */
  book: string;
  files: VaultAdapter;
  metadata(): Promise<BookMetadata | undefined>;
  /** Opens the design panel, where a face is picked. */
  openPanel(): void;
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
    this.setTitle(`Export to ${pdfTarget.label}`);
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
  private async typeset(): Promise<Typeset> {
    const { composer, book } = this.exports;
    const open = composer.opened(book) ?? composer.open(book);
    const typeset = await open;
    return typeset.dropped ? composer.open(book) : typeset;
  }

  private exporter(): Exporter {
    const { book, files, openPanel } = this.exports;
    const { workspace } = this.app;
    return {
      prepare: async () => {
        const metadata = (await this.exports.metadata()) ?? {};
        return {
          name: exportName(metadata, pdfTarget.extension),
          path: exportPath(book, metadata, pdfTarget.extension),
        };
      },
      check: async () => {
        const typeset = await this.typeset();
        await typeset.resolving;
        return preflight({
          design: typeset.design,
          unloaded: typeset.unloaded,
          unread: typeset.unread,
          warnings: typeset.session.warnings,
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
      choose: (name) => chooseDiskPath(name, pdfTarget),
      write: async (destination) => {
        const typeset = await this.typeset();
        const sink = desktopSink(files);
        return pdfTarget.run(typeset.session, (bytes) => sink.write(destination, bytes));
      },
      open: (path) => {
        void workspace.openLinkText(path, "", true);
      },
      fix: (blocker) => {
        this.close();
        if (blocker.at === undefined) {
          openPanel();
          return;
        }
        void workspace.openLinkText(blocker.at.note, "", false, {
          eState: { line: blocker.at.line },
        });
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
