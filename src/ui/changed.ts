import { ButtonComponent, Modal, type App } from "obsidian";
import { device } from "@/ui/desktop";

/** The two versions of the note, and which one the author keeps. */
export interface Choice {
  /** Writes the view's unwritten edit over the note. */
  keep(): void;
  /** Drops that edit and opens the note as it is on disk. */
  reload(): void;
}

/**
 * The note changed on disk while the view had an unwritten edit. Closing
 * without choosing leaves the note and the edit as they are, and the
 * next edit is written over the note on settle.
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
      text: "This note changed outside Orca.",
    });

    const buttons = pane.createDiv({ cls: "modal-button-container orca-changed-buttons" });
    const reload = (): void => {
      new ButtonComponent(buttons)
        .setButtonText("Use the saved version")
        .onClick(() => {
          this.chose(() => {
            this.choice.reload();
          });
        });
    };
    const keep = (): void => {
      new ButtonComponent(buttons)
        .setButtonText("Keep my changes")
        .setCta()
        .onClick(() => {
          this.chose(() => {
            this.choice.keep();
          });
        });
    };
    // The mobile artboards stack the two, with the author's edit first.
    for (const draw of device() === "desktop" ? [reload, keep] : [keep, reload]) draw();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private chose(taken: () => void): void {
    this.close();
    taken();
  }
}
