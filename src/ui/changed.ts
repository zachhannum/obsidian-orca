import { ButtonComponent, Modal, type App } from "obsidian";

/** The two versions of the note, and which one the author keeps. */
export interface Choice {
  /** Writes the edit the view is holding over the note. */
  keep(): void;
  /** Drops that edit and opens the note as it is on disk. */
  reload(): void;
}

/**
 * The note changed on disk while the view was holding an edit. Closing
 * without choosing leaves both as they are, and the next edit settles
 * over the note.
 */
export class Changed extends Modal {
  constructor(
    app: App,
    private readonly choice: Choice,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("The book changed on disk");
    const pane = this.contentEl;
    pane.dataset["testid"] = "orca-book-changed";
    pane.createEl("p", {
      text: "This note was written outside orca, and orca is holding an edit that is not in it.",
    });

    const buttons = pane.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(buttons)
      .setButtonText("Take what is on disk")
      .onClick(() => {
        this.chose(() => {
          this.choice.reload();
        });
      });
    new ButtonComponent(buttons)
      .setButtonText("Keep my edit")
      .setCta()
      .onClick(() => {
        this.chose(() => {
          this.choice.keep();
        });
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private chose(taken: () => void): void {
    this.close();
    taken();
  }
}
