/**
 * The editor over the book's own CSS. It is CodeMirror as Obsidian
 * ships it, so every package here but the CSS grammar is Obsidian's
 * instance and nothing is bundled twice. CodeMirror owns its DOM, so
 * the editor sits beside the React panel and never inside it.
 */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cssLanguage } from "@codemirror/lang-css";
import { syntaxHighlighting } from "@codemirror/language";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";

/** The editor over the fence, held by the panel view. */
export interface CssEditor {
  /** Shows this CSS. Showing it tells the view nothing, so it does not write. */
  show(css: string): void;
  /** Wraps long lines, or scrolls them sideways, which is the default. */
  wrap(on: boolean): void;
  destroy(): void;
}

/** Marks a change that came from the note rather than from the author. */
const shown = Annotation.define<boolean>();

/** The line wrapping, which the author switches while the editor is open. */
const wrapping = new Compartment();

/**
 * The editor's extensions: the CSS grammar and no language feature
 * beyond it, so nothing here lints or completes. The engine is the only
 * linter.
 */
export function cssExtensions(changed: (css: string) => void): Extension[] {
  return [
    cssLanguage,
    syntaxHighlighting(classHighlighter),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    wrapping.of([]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.transactions.some((tr) => tr.annotation(shown) === true)) return;
      changed(update.state.doc.toString());
    }),
  ];
}

/** Mounts the editor under an element the view owns. */
export function mountEditor(
  parent: HTMLElement,
  css: string,
  changed: (css: string) => void,
): CssEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: css, extensions: cssExtensions(changed) }),
  });
  return {
    show(next) {
      const now = view.state.doc.toString();
      if (now === next) return;
      view.dispatch({
        changes: { from: 0, to: now.length, insert: next },
        annotations: shown.of(true),
      });
    },
    wrap(on) {
      view.dispatch({
        effects: wrapping.reconfigure(on ? EditorView.lineWrapping : []),
      });
    },
    destroy() {
      view.destroy();
    },
  };
}
