/**
 * The editor over the book's own CSS. It is CodeMirror as Obsidian
 * ships it, so every package here but the CSS grammar is Obsidian's
 * instance and nothing is bundled twice. CodeMirror owns its DOM, so
 * the editor sits beside the React panel and never inside it.
 */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cssLanguage } from "@codemirror/lang-css";
import {
  ensureSyntaxTree,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Range,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutterLineClass,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import type { Place } from "@/style/origin";

/** The editor over the fence, held by the panel view. */
export interface CssEditor {
  /** Shows this CSS. Showing it tells the view nothing, so it does not write. */
  show(css: string): void;
  /** Wraps long lines, or scrolls them sideways, which is the default. */
  wrap(on: boolean): void;
  /** Puts a render's warnings on the text. See {@link flagged}. */
  flag(flags: readonly Flag[], against: string): void;
  destroy(): void;
}

/** A warning the engine put on the author's CSS, at the place it named. */
export interface Flag extends Place {
  message: string;
}

/** A flag as it sits on the text now, moved with every edit since. */
export interface Flagged {
  from: number;
  to: number;
  message: string;
}

/** Marks a change that came from the note rather than from the author. */
const shown = Annotation.define<boolean>();

/** The line wrapping, which the author switches while the editor is open. */
const wrapping = new Compartment();

/** Replaces every flag with a render's. */
const reflag = StateEffect.define<DecorationSet>();

const flags = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    for (const effect of tr.effects) if (effect.is(reflag)) return effect.value;
    return set.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

class FlaggedLine extends GutterMarker {
  override elementClass = "orca-editor-flagged";
}

const flaggedLine = new FlaggedLine();

/** Colours the number of every line a flag starts on. */
const flaggedLines = gutterLineClass.compute([flags], (state) => {
  const lines: Range<GutterMarker>[] = [];
  for (let at = state.field(flags).iter(); at.value !== null; at.next()) {
    lines.push(flaggedLine.range(state.doc.lineAt(at.from).from));
  }
  return RangeSet.of(lines, true);
});

/**
 * The editor's extensions: the CSS grammar and the engine's warnings
 * on the text. Nothing here lints or completes. Every flag comes from a
 * render, because the engine is the only linter.
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
    flags,
    flaggedLines,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.transactions.some((tr) => tr.annotation(shown) === true)) return;
      changed(update.state.doc.toString());
    }),
  ];
}

/**
 * The transaction that puts a render's warnings on the text. A warning
 * names a place in the CSS the render set, so the flags go on only when
 * the text is that CSS. Otherwise the author typed past it, and the
 * flags already on the text stay, moved with the typing, until the
 * render for the new text lands.
 */
export function flagged(
  state: EditorState,
  warned: readonly Flag[],
  against: string,
): TransactionSpec | undefined {
  if (state.doc.toString() !== against) return undefined;
  const marks = warned.flatMap((flag) => {
    const range = flagRange(state, flag);
    if (range === undefined) return [];
    const mark = Decoration.mark({
      class: "orca-editor-flag",
      attributes: { title: flag.message, "data-testid": "orca-editor-flag" },
    });
    return [mark.range(range.from, range.to)];
  });
  return { effects: reflag.of(Decoration.set(marks, true)) };
}

/** The flags on the text, in document order. */
export function flagsIn(state: EditorState): Flagged[] {
  const found: Flagged[] = [];
  for (let at = state.field(flags).iter(); at.value !== null; at.next()) {
    const title: unknown = (at.value.spec as { attributes?: { title?: unknown } })
      .attributes?.title;
    found.push({ from: at.from, to: at.to, message: typeof title === "string" ? title : "" });
  }
  return found;
}

/**
 * The text a flag underlines. The engine names where a declaration
 * starts, and the grammar the editor already carries says where it
 * ends. A place the grammar puts in no declaration underlines the rest
 * of its line.
 */
function flagRange(state: EditorState, flag: Flag): { from: number; to: number } | undefined {
  if (flag.line < 1 || flag.line > state.doc.lines) return undefined;
  const line = state.doc.line(flag.line);
  const from = Math.min(line.from + Math.max(flag.column - 1, 0), line.to);
  const tree = ensureSyntaxTree(state, line.to, 50) ?? syntaxTree(state);
  for (let node = tree.resolveInner(from, 1); ; ) {
    if (node.name === "Declaration") return { from: node.from, to: node.to };
    const parent = node.parent;
    if (parent === null) break;
    node = parent;
  }
  const to = line.from + line.text.trimEnd().length;
  return to > from ? { from, to } : undefined;
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
    flag(warned, against) {
      const spec = flagged(view.state, warned, against);
      if (spec !== undefined) view.dispatch(spec);
    },
    destroy() {
      view.destroy();
    },
  };
}
