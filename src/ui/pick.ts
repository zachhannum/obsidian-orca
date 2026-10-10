/**
 * A fuzzy pick over a list. The navigator asks for a note, a book or a
 * role with one.
 */

import { FuzzySuggestModal, type App, type FuzzyMatch } from "obsidian";

/** The items to pick from, and what to do with the pick. */
export interface Picking<T> {
  items: T[];
  label(item: T): string;
  /** A line under the label. The pick matches on the label alone. */
  note?(item: T): string;
  /** An item for what the author typed, which the pick lists after its matches. */
  typed?(query: string): T | undefined;
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

  override getSuggestions(query: string): FuzzyMatch<T>[] {
    const found = super.getSuggestions(query);
    const typed = this.of.typed?.(query);
    if (typed === undefined) return found;
    return [...found, { item: typed, match: { score: 0, matches: [] } }];
  }

  // The title and the note take the classes Obsidian gives a suggestion
  // of two lines, so the row is drawn as its own are.
  override renderSuggestion(match: FuzzyMatch<T>, el: HTMLElement): void {
    const note = this.of.note?.(match.item);
    if (note === undefined) {
      super.renderSuggestion(match, el);
      return;
    }
    const content = el.createDiv({ cls: "suggestion-content" });
    super.renderSuggestion(match, content.createDiv({ cls: "suggestion-title" }));
    const line = content.createDiv({ cls: "suggestion-note", text: note });
    line.dataset["testid"] = "orca-pick-note";
  }

  onChooseItem(item: T): void {
    this.of.chose(item);
  }
}

/** Opens the pick. Nothing happens if the author closes it. */
export function pick<T>(app: App, of: Picking<T>): void {
  new Picker(app, of).open();
}
