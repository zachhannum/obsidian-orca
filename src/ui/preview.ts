import { paintPage } from "fleuron";
import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { SAMPLE, openBook } from "@/book/sample";
import { EngineError } from "@/engine/errors";
import type { Reading, Session } from "@/engine/session";
import { showPage, turnedTo } from "@/ui/page";

/** The type the preview is registered under. */
export const PREVIEW_VIEW = "orca-book-preview";

/**
 * One page of the book, and the chrome to page through it: previous,
 * next, and a folio you can type. The painter settles what is on a
 * page, so its markup goes into the surface in one write.
 */
export class PreviewView extends ItemView {
  private well: HTMLElement | undefined;
  private surface: HTMLElement | undefined;
  private message: HTMLElement | undefined;
  private folio: HTMLInputElement | undefined;
  private total: HTMLElement | undefined;
  private status: HTMLElement | undefined;
  private back: HTMLButtonElement | undefined;
  private on: HTMLButtonElement | undefined;
  private session: Session | undefined;
  /** The page being read, counting from 0. */
  private at = 0;
  /** The book's length in pages, as the last page painted counted it. */
  private pages = 0;
  /** The turn the next painted page has to be, so a slow one is dropped. */
  private turning = 0;

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
    this.chrome(pane);

    try {
      const session = await this.opening;
      await session.open(openBook(SAMPLE));
      this.session = session;
      await this.turn(0);
    } catch (cause) {
      this.report(
        cause instanceof EngineError ? cause.message : "The book did not set",
      );
    }
  }

  override onClose(): Promise<void> {
    this.well = undefined;
    this.surface = undefined;
    this.message = undefined;
    this.folio = undefined;
    this.total = undefined;
    this.status = undefined;
    this.back = undefined;
    this.on = undefined;
    this.session = undefined;
    this.contentEl.empty();
    return Promise.resolve();
  }

  /** Draws the toolbar, the well the page sits in, and the status line. */
  private chrome(pane: HTMLElement): void {
    const bar = pane.createDiv({ cls: "orca-preview-bar" });
    this.back = this.turnsTo(bar, "chevron-left", "Previous page", -1);
    const folio = bar.createEl("input", { cls: "orca-preview-folio" });
    folio.type = "text";
    folio.inputMode = "numeric";
    folio.setAttribute("aria-label", "Page");
    folio.dataset["testid"] = "orca-folio";
    this.folio = folio;
    this.total = bar.createSpan({ cls: "orca-preview-total" });
    this.on = this.turnsTo(bar, "chevron-right", "Next page", 1);

    const well = pane.createDiv({ cls: "orca-preview-well" });
    // The pane pages through from the keyboard, so the well the page
    // sits in is what a Tab or a click on the page reaches.
    well.tabIndex = 0;
    this.well = well;
    this.message = well.createDiv({
      cls: "orca-preview-message",
      text: "Setting the book",
    });
    const surface = well.createDiv({ cls: "orca-page" });
    surface.dataset["testid"] = "orca-page";
    this.surface = surface;

    const status = pane.createDiv({ cls: "orca-preview-status" });
    status.dataset["testid"] = "orca-status";
    this.status = status;

    this.registerDomEvent(folio, "change", () => {
      this.typed(folio.value);
    });
    this.registerDomEvent(this.containerEl, "keydown", (event) => {
      // The folio is a field, so Home and End belong to its caret.
      if (event.target === folio) return;
      const to = turnedTo(event.key, this.at, this.pages);
      if (to === undefined) return;
      event.preventDefault();
      void this.turn(to);
    });
  }

  /** A button that turns `by` pages from the one being read. */
  private turnsTo(
    bar: HTMLElement,
    icon: string,
    label: string,
    by: number,
  ): HTMLButtonElement {
    const button = bar.createEl("button", { cls: "clickable-icon" });
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    this.registerDomEvent(button, "click", () => {
      void this.turn(this.at + by);
    });
    return button;
  }

  /** Reads a typed folio, and puts the one being read back when it is not one. */
  private typed(value: string): void {
    const folio = Number.parseInt(value, 10);
    if (Number.isNaN(folio)) {
      this.settle(this.at, this.pages);
      return;
    }
    void this.turn(folio - 1);
  }

  /**
   * Paints the page at `at`. A turn the reader has already typed past
   * is dropped rather than painted behind the one they are on.
   */
  private async turn(at: number): Promise<void> {
    const session = this.session;
    if (session === undefined) return;
    const turn = (this.turning += 1);
    const reading = await session.read(at);
    if (turn !== this.turning || this.surface === undefined) return;
    if (reading === undefined) {
      this.report("The book set to no pages");
      return;
    }
    this.message?.remove();
    this.message = undefined;
    this.paint(session, reading);
  }

  private paint(session: Session, reading: Reading): void {
    const surface = this.surface;
    if (surface === undefined) return;
    showPage(surface, {
      markup: paintPage(reading.page, {
        fonts: reading.fonts,
        assets: reading.assets,
      }),
      generation: session.generation,
      stages: session.stages,
      page: reading.at + 1,
      pages: reading.pages,
    });
    this.settle(reading.at, reading.pages);
  }

  /** Puts the chrome on the page that is painted. */
  private settle(at: number, pages: number): void {
    this.at = at;
    this.pages = pages;
    const folio = at + 1;
    if (this.folio !== undefined) this.folio.value = String(folio);
    this.total?.setText(`of ${String(pages)}`);
    this.status?.setText(`page ${String(folio)} of ${String(pages)}`);
    if (this.back !== undefined) this.back.disabled = at === 0;
    if (this.on !== undefined) this.on.disabled = at >= pages - 1;
  }

  /** Puts a message in the well in place of a page. */
  private report(text: string): void {
    if (this.message !== undefined) {
      this.message.setText(text);
      return;
    }
    this.message = this.well?.createDiv({ cls: "orca-preview-message", text });
  }
}
