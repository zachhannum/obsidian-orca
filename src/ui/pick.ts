/**
 * A fuzzy pick over a list. The navigator asks for a note, a book or a
 * role with one.
 */

import { FuzzySuggestModal, type App } from "obsidian";

/** What is picked from, and what is done with the pick. */
export interface Picking<T> {
  items: T[];
  label(item: T): string;
  placeholder: string;
  chose(item: T): void;
}

class Picker<T> extends FuzzySuggestModal<T> {
  constructor(
    app: App,
    private readonly of: Picking<T>,
  ) {
    super(app);
    this.setPlaceholder(of.placeholder);
    this.modalEl.dataset["testid"] = "orca-pick";
  }

  getItems(): T[] {
    return this.of.items;
  }

  getItemText(item: T): string {
    return this.of.label(item);
  }

  onChooseItem(item: T): void {
    this.of.chose(item);
  }
}

/** Opens the pick. Nothing happens if the author closes it. */
export function pick<T>(app: App, of: Picking<T>): void {
  new Picker(app, of).open();
}
