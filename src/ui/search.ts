/**
 * The search panel over the CSS editor. CodeMirror's own panel labels
 * its buttons in words and its switches with checkboxes, so this one
 * draws Obsidian's fields and icons over the same search state.
 */

import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";

/** Lucide's icons, drawn here because CodeMirror owns this DOM. */
const ICONS = {
  case: ["m3 15 4-8 4 8", "M4 13h6", "M21 9v6", "M15 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0"],
  regexp: [
    "M17 3v10",
    "m12.67 5.5 8.66 5",
    "m12.67 10.5 8.66-5",
    "M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z",
  ],
  previous: ["m5 12 7-7 7 7", "M12 19V5"],
  next: ["M12 5v14", "m19 12-7 7-7-7"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  replace: [
    "M14 4a1 1 0 0 1 1-1",
    "M15 10a1 1 0 0 1-1-1",
    "M21 4a1 1 0 0 0-1-1",
    "M21 9a1 1 0 0 1-1 1",
    "m3 7 3 3 3-3",
    "M6 10V5a2 2 0 0 1 2-2h2",
    "M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z",
  ],
  replaceAll: [
    "M14 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1",
    "M14 4a1 1 0 0 1 1-1",
    "M15 10a1 1 0 0 1-1-1",
    "M19 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1",
    "M21 4a1 1 0 0 0-1-1",
    "M21 9a1 1 0 0 1-1 1",
    "m3 7 3 3 3-3",
    "M6 10V5a2 2 0 0 1 2-2h2",
    "M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z",
  ],
} as const;

/** Draws the search panel. CodeMirror focuses the field marked `main-field` when it opens. */
export function searchPanel(view: EditorView): Panel {
  const document = view.dom.ownerDocument;
  let query = getSearchQuery(view.state);

  const dom = document.createElement("div");
  dom.className = "orca-search";
  dom.dataset["testid"] = "orca-editor-search";

  const row = (): HTMLElement => {
    const div = dom.appendChild(document.createElement("div"));
    div.className = "orca-search-row";
    return div;
  };

  const field = (into: HTMLElement, label: string, value: string): HTMLInputElement => {
    const input = into.appendChild(document.createElement("input"));
    input.type = "text";
    input.className = "orca-search-field";
    input.placeholder = label;
    input.setAttribute("aria-label", label);
    input.spellcheck = false;
    input.value = value;
    input.addEventListener("input", commit);
    return input;
  };

  const button = (
    into: HTMLElement,
    label: string,
    icon: readonly string[],
    run: () => void,
  ): HTMLElement => {
    const div = into.appendChild(document.createElement("div"));
    div.className = "clickable-icon orca-search-button";
    div.setAttribute("role", "button");
    div.setAttribute("aria-label", label);
    const svg = div.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    svg.setAttribute("class", "svg-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const d of icon) {
      svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path")).setAttribute("d", d);
    }
    // A press on the button keeps the focus in the field it belongs to.
    div.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    div.addEventListener("click", run);
    return div;
  };

  const toggle = (into: HTMLElement, label: string, icon: readonly string[]): HTMLElement => {
    const div = button(into, label, icon, () => {
      set(div, !pressed(div));
      commit();
    });
    return div;
  };

  const finding = row();
  const search = field(finding, "Find", query.search);
  search.setAttribute("main-field", "true");
  const matchCase = toggle(finding, "Match case", ICONS.case);
  const regexp = toggle(finding, "Use regular expression", ICONS.regexp);
  button(finding, "Previous match", ICONS.previous, () => findPrevious(view));
  button(finding, "Next match", ICONS.next, () => findNext(view));
  button(finding, "Close", ICONS.close, () => closeSearchPanel(view));

  const replacing = row();
  const replace = field(replacing, "Replace", query.replace);
  button(replacing, "Replace", ICONS.replace, () => replaceNext(view));
  button(replacing, "Replace all", ICONS.replaceAll, () => replaceAll(view));

  function show(next: SearchQuery): void {
    query = next;
    search.value = next.search;
    replace.value = next.replace;
    set(matchCase, next.caseSensitive);
    set(regexp, next.regexp);
  }

  function commit(): void {
    const next = new SearchQuery({
      search: search.value,
      replace: replace.value,
      caseSensitive: pressed(matchCase),
      regexp: pressed(regexp),
      wholeWord: query.wholeWord,
    });
    if (next.eq(query)) return;
    query = next;
    view.dispatch({ effects: setSearchQuery.of(next) });
  }

  show(query);

  dom.addEventListener("keydown", (event) => {
    if (runScopeHandlers(view, event, "search-panel")) {
      event.preventDefault();
    } else if (event.key === "Enter" && event.target === search) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
    } else if (event.key === "Enter" && event.target === replace) {
      event.preventDefault();
      replaceNext(view);
    }
  });

  return {
    dom,
    top: true,
    mount() {
      search.select();
    },
    update(update: ViewUpdate) {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery) && !effect.value.eq(query)) show(effect.value);
        }
      }
    },
  };
}

function pressed(button: HTMLElement): boolean {
  return button.getAttribute("aria-pressed") === "true";
}

function set(button: HTMLElement, on: boolean): void {
  button.setAttribute("aria-pressed", String(on));
  button.classList.toggle("is-active", on);
}
