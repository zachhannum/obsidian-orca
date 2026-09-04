import { paintPage } from "fleuron";
import { ItemView, type WorkspaceLeaf } from "obsidian";
import { SAMPLE, openBook } from "@/book/sample";
import { EngineError } from "@/engine/errors";
import type { Session } from "@/engine/session";
import { showPage } from "@/ui/page";

/** The type the preview is registered under. */
export const PREVIEW_VIEW = "orca-book-preview";

/**
 * One page of the book. The painter settles what a page holds, so its
 * markup goes into the surface in one write.
 */
export class PreviewView extends ItemView {
  private surface: HTMLElement | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly opening: Promise<Session>,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PREVIEW_VIEW;
  }

  override getDisplayText(): string {
    return "Book";
  }

  override getIcon(): string {
    return "book";
  }

  override async onOpen(): Promise<void> {
    const pane = this.contentEl;
    pane.empty();
    pane.addClass("orca-preview");
    pane.dataset["testid"] = "orca-preview";
    const status = pane.createDiv({ cls: "orca-status", text: "Setting the book" });
    const surface = pane.createDiv({ cls: "orca-page" });
    surface.dataset["testid"] = "orca-page";
    this.surface = surface;

    try {
      const session = await this.opening;
      await session.open(openBook(SAMPLE));
      if (this.paint(session)) status.remove();
      else status.setText("The book set to no pages");
    } catch (cause) {
      status.setText(
        cause instanceof EngineError ? cause.message : "The book did not set",
      );
    }
  }

  override onClose(): Promise<void> {
    this.surface = undefined;
    this.contentEl.empty();
    return Promise.resolve();
  }

  private paint(session: Session): boolean {
    const surface = this.surface;
    const output = session.output;
    const page = output?.pages[0];
    // The leaf can close while the first layout is still out.
    if (surface === undefined || output === undefined || page === undefined) {
      return false;
    }
    showPage(surface, {
      markup: paintPage(page, { fonts: output.fonts, assets: output.assets }),
      generation: session.generation,
      stages: session.stages,
    });
    return true;
  }
}
