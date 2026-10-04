/**
 * The toolbar over the keyboard on a phone and a tablet. It is drawn
 * while the CSS view has the caret, and holds what the system keyboard
 * puts several taps deep.
 */

import { insertBracket } from "@codemirror/autocomplete";
import { historyKeymap } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { EditorState, Extension, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, type Command } from "@codemirror/view";
import type { Device } from "@/ui/device";
import type { DrawIcon } from "@/ui/editor";

/** The marks every rule is written in. */
const MARKS = ["{", "}", ":", ";"] as const;

/** The marks a selector and an at-rule open with, which a tablet has the width for. */
const WIDE_MARKS = ["#", ".", "@"] as const;

/** The marks the toolbar holds, in the order it draws them. */
export function marks(device: Device): readonly string[] {
  return device === "tablet" ? [...MARKS, ...WIDE_MARKS] : MARKS;
}

/**
 * The transaction a mark's button makes. It is the one the key makes,
 * so a brace brings its pair and a closing brace steps over the one
 * already there.
 */
export function marked(state: EditorState, mark: string): Transaction {
  return (
    insertBracket(state, mark) ??
    state.update(state.replaceSelection(mark), { scrollIntoView: true, userEvent: "input.type" })
  );
}

/** The command the history binds to a key, which is undo for `Mod-z` and redo for `Mod-y`. */
function bound(key: string): Command | undefined {
  return historyKeymap.find((binding) => binding.key === key)?.run;
}

/**
 * Draws the toolbar on the body while the focus is inside the editor,
 * which the search panel is part of. The editor's host carries
 * `is-typing` for as long, and `--orca-editor-foot`, the room between
 * the foot of the drawer and the foot of the screen, so the sheet can
 * end above the toolbar.
 */
export function toolbar(device: Device, icon: DrawIcon): Extension {
  return ViewPlugin.define((view) => {
    const document = view.dom.ownerDocument;
    const host = view.dom.parentElement;

    const bar = document.body.createDiv({ cls: "orca-toolbar" });
    bar.dataset["testid"] = "orca-toolbar";
    bar.hidden = true;

    const option = (into: HTMLElement, name: string, label: string, run: () => void): HTMLElement => {
      const div = into.createDiv({ cls: "orca-toolbar-option" });
      div.dataset["testid"] = `orca-toolbar-${name}`;
      div.setAttribute("role", "button");
      div.setAttribute("aria-label", label);
      // A press on the toolbar keeps the caret, and the keyboard with it.
      div.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      div.addEventListener("click", run);
      return div;
    };

    const list = bar.createDiv({ cls: "orca-toolbar-list" });
    icon(option(list, "undo", "Undo", () => bound("Mod-z")?.(view)), "undo-2");
    icon(option(list, "redo", "Redo", () => bound("Mod-y")?.(view)), "redo-2");
    icon(option(list, "search", "Search", () => openSearchPanel(view)), "search");
    for (const mark of marks(device)) {
      option(list, "mark", `Insert ${mark}`, () => {
        view.dispatch(marked(view.state, mark));
      }).setText(mark);
    }
    icon(
      option(bar, "hide", "Hide keyboard", () => {
        view.contentDOM.blur();
      }),
      "keyboard",
    );

    const measure = (): void => {
      view.requestMeasure({
        key: bar,
        read: () => {
          const drawer = host?.parentElement;
          if (drawer === null || drawer === undefined) return 0;
          return Math.max(0, document.win.innerHeight - drawer.getBoundingClientRect().bottom);
        },
        write: (foot) => {
          host?.setCssProps({ "--orca-editor-foot": `${String(foot)}px` });
        },
      });
    };

    const show = (on: boolean): void => {
      if (bar.hidden === !on) return;
      bar.hidden = !on;
      host?.toggleClass("is-typing", on);
      if (on) measure();
    };
    const entered = (): void => {
      show(true);
    };
    const left = (event: FocusEvent): void => {
      if (!view.dom.contains(event.relatedTarget as Node | null)) show(false);
    };
    view.dom.addEventListener("focusin", entered);
    view.dom.addEventListener("focusout", left);
    document.win.addEventListener("resize", measure);

    // The keyboard takes the foot of the sheet when it rises, and the
    // caret may be on a line it took.
    let height = view.scrollDOM.clientHeight;
    const resized = new ResizeObserver(() => {
      const now = view.scrollDOM.clientHeight;
      const shrank = now < height;
      height = now;
      if (!shrank || bar.hidden) return;
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head) });
    });
    resized.observe(view.scrollDOM);

    return {
      destroy() {
        resized.disconnect();
        view.dom.removeEventListener("focusin", entered);
        view.dom.removeEventListener("focusout", left);
        document.win.removeEventListener("resize", measure);
        host?.removeClass("is-typing");
        bar.remove();
      },
    };
  });
}
