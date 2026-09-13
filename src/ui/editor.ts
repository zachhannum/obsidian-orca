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
  hoverTooltip,
  keymap,
  lineNumbers,
  tooltips,
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
  /** Puts the caret at a line and column, scrolled into view. See {@link revealed}. */
  reveal(line: number, column: number): void;
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
  sheet: string;
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

/** The card over a squiggle, which carries the engine's own words. */
const flagHover = hoverTooltip((view, pos) => {
  const here = flagsAt(view.state, pos);
  if (here.length === 0) return null;
  return {
    pos: Math.min(...here.map((found) => found.from)),
    end: Math.max(...here.map((found) => found.to)),
    above: true,
    create: () => ({ dom: flagCard(view, here) }),
  };
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
    flagHover,
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
      attributes: { "data-testid": "orca-editor-flag" },
      sheet: flag.sheet,
      message: flag.message,
    });
    return [mark.range(range.from, range.to)];
  });
  return { effects: reflag.of(Decoration.set(marks, true)) };
}

/**
 * The transaction that puts the caret where a warning named, both
 * counted from 1. A column past the end of its line stops at the end,
 * and a line the text does not have moves nothing.
 */
export function revealed(
  state: EditorState,
  line: number,
  column: number,
): TransactionSpec | undefined {
  if (line < 1 || line > state.doc.lines) return undefined;
  const at = state.doc.line(line);
  const pos = Math.min(at.from + Math.max(column - 1, 0), at.to);
  return {
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  };
}

/** The flags on the text, in document order. */
export function flagsIn(state: EditorState): Flagged[] {
  const found: Flagged[] = [];
  for (let at = state.field(flags).iter(); at.value !== null; at.next()) {
    const spec = at.value.spec as { sheet?: unknown; message?: unknown };
    found.push({
      from: at.from,
      to: at.to,
      sheet: typeof spec.sheet === "string" ? spec.sheet : "",
      message: typeof spec.message === "string" ? spec.message : "",
    });
  }
  return found;
}

/** The flags a pointer at this position is over, which one card shows. */
export function flagsAt(state: EditorState, pos: number): Flagged[] {
  return flagsIn(state).filter((found) => found.from <= pos && pos <= found.to);
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

/** The icon Obsidian draws a warning with, drawn here because CodeMirror owns this DOM. */
const WARNING_PATHS = [
  "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
  "M12 9v4",
  "M12 17h.01",
];

/**
 * One card for every flag under the pointer. Each row is the engine's
 * message as it sent it, and the place it names now, which moves with
 * the typing.
 */
function flagCard(view: EditorView, here: readonly Flagged[]): HTMLElement {
  const document = view.dom.ownerDocument;
  const card = document.createElement("div");
  card.className = "orca-editor-card";
  card.dataset["testid"] = "orca-editor-card";
  for (const found of here) {
    const row = card.appendChild(document.createElement("div"));
    row.className = "orca-editor-card-row";

    const svg = row.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    svg.setAttribute("class", "orca-editor-card-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const d of WARNING_PATHS) {
      svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path")).setAttribute("d", d);
    }

    const body = row.appendChild(document.createElement("div"));
    body.className = "orca-editor-card-body";
    const said = body.appendChild(document.createElement("div"));
    said.className = "orca-editor-card-said";
    said.textContent = found.message;
    const line = view.state.doc.lineAt(found.from);
    const at = body.appendChild(document.createElement("div"));
    at.className = "orca-editor-card-at";
    at.textContent = `${found.sheet}:${String(line.number)}:${String(found.from - line.from + 1)}`;
  }
  return card;
}

/** Mounts the editor under an element the view owns. */
export function mountEditor(
  parent: HTMLElement,
  css: string,
  changed: (css: string) => void,
): CssEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: css,
      extensions: [
        ...cssExtensions(changed),
        // The host clips its overflow, so a card near its edge is drawn
        // on the body instead.
        tooltips({ parent: parent.ownerDocument.body }),
      ],
    }),
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
    reveal(line, column) {
      const spec = revealed(view.state, line, column);
      if (spec === undefined) return;
      view.dispatch(spec);
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
