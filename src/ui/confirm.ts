/**
 * The question asked before something orca cannot take back.
 */

import { ButtonComponent, Modal, type App } from "obsidian";

/** What is being asked, and what to do when the author says yes. */
export interface Asking {
  title: string;
  /** What happens, in the author's own terms. */
  said: string;
  /** The verb on the button that goes ahead. */
  verb: string;
  done(): void;
}

class Confirm extends Modal {
  constructor(
    app: App,
    private readonly asking: Asking,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.dataset["testid"] = "orca-confirm";
    this.setTitle(this.asking.title);
    this.contentEl.createEl("p", { text: this.asking.said });
    const buttons = this.contentEl.createDiv("modal-button-container");
    new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => {
      this.close();
    });
    new ButtonComponent(buttons)
      .setButtonText(this.asking.verb)
      .setWarning()
      .onClick(() => {
        this.close();
        this.asking.done();
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Asks, and goes ahead only if the author says so. */
export function confirm(app: App, asking: Asking): void {
  new Confirm(app, asking).open();
}
