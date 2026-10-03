/**
 * The sheet a phone opens a dialog as: Obsidian's own modal, docked to
 * the foot of the screen under a grabber.
 */

import { Modal, type App } from "obsidian";
import { device } from "@/ui/desktop";
import { sheets } from "@/ui/device";

/**
 * Titles a modal, and on a phone docks it as a sheet. Obsidian docks
 * its own confirmations with `mod-confirmation`, which the plugin API
 * does not name, so an Obsidian without the class leaves the modal
 * centered. The title Obsidian drags a modal shut by holds the grabber,
 * and `setTitle` would empty it out, so the title is set through the
 * function this returns.
 */
export function docks(modal: Modal, said: string): (said: string) => void {
  if (!sheets(device())) {
    modal.setTitle(said);
    return (next) => {
      modal.setTitle(next);
    };
  }
  modal.containerEl.addClass("mod-confirmation", "orca-sheet");
  modal.titleEl.empty();
  const grabber = modal.titleEl.createDiv({
    cls: "orca-sheet-grabber",
    attr: { role: "button", tabindex: "0", "aria-label": "Close", "data-testid": "orca-sheet-grabber" },
  });
  grabber.createDiv("menu-grabber");
  grabber.addEventListener("click", () => {
    modal.close();
  });
  grabber.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    modal.close();
  });
  const title = modal.titleEl.createSpan({ cls: "orca-sheet-title", text: said });
  return (next) => {
    title.setText(next);
  };
}

/** An open sheet, as its owner holds it. */
export interface Sheet {
  /** The element the owner draws under. The sheet never empties it. */
  el: HTMLElement;
  /** The sheet as it is drawn, whose height is what it covers. */
  frame: HTMLElement;
  title(said: string): void;
  close(): void;
}

/** The title, the names and the listener a sheet is opened with. */
export interface Asked {
  title: string;
  testid: string;
  /** The class the sheet's own rules hang from. */
  cls: string;
  /** Leaves what is behind the sheet undimmed. */
  clear?: boolean;
  /**
   * Runs once, however the sheet was closed, and before `close`
   * returns when the owner closed it.
   */
  closed(): void;
}

class SheetModal extends Modal {
  title: (said: string) => void = () => undefined;
  private shut = false;

  constructor(
    app: App,
    private readonly asked: Asked,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.dataset["testid"] = this.asked.testid;
    this.modalEl.addClass(this.asked.cls);
    if (this.asked.clear === true) this.containerEl.addClass("orca-sheet-clear");
    this.title = docks(this, this.asked.title);
  }

  override onClose(): void {
    if (this.shut) return;
    this.shut = true;
    this.asked.closed();
  }

  /**
   * Closes the sheet once. A phone slides a modal shut before it tells
   * the modal, so the owner hears here, while the sheet is still drawn.
   */
  shuts(): void {
    if (this.shut) return;
    this.shut = true;
    this.asked.closed();
    this.close();
  }
}

/** Opens a sheet. Only a phone asks for one. */
export function openSheet(app: App, asked: Asked): Sheet {
  const modal = new SheetModal(app, asked);
  modal.open();
  return {
    el: modal.contentEl,
    frame: modal.modalEl,
    title: (said) => {
      modal.title(said);
    },
    close: () => {
      modal.shuts();
    },
  };
}
