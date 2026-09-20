/**
 * The marks the editor draws over a note of a book: the chips over
 * fleuron's attribute runs, the headings over a setext underline, and
 * the rules over its break commands.
 *
 * The marks are orca's own parse of the text the editor holds, so a
 * chip is drawn on the keystroke that made it. Nothing is counted in
 * other text than the text it was read from, and nothing waits on a
 * render.
 */

import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { marksIn, type Drawn, type Form, type Names } from "@/book/marks";
import { breakElement, chipElement } from "@/ui/chip";

/** The books a note is drawn against, as much of them as the editor reads. */
export interface Marking {
  /** Whether a book lists this note. A note no book lists takes no marks. */
  member(note: string): boolean;
  /** Told when the books changed, so every open note is read again. */
  watch(reread: () => void): () => void;
}

/** A placed decoration, before the set is built. */
interface Placed {
  from: number;
  to: number;
  value: Decoration;
}

/** The chip that names a run, drawn where the run was written. */
class Chip extends WidgetType {
  constructor(
    private readonly names: Names,
    private readonly form: Form,
  ) {
    super();
  }

  override eq(other: Chip): boolean {
    return other.names.said === this.names.said && other.form === this.form;
  }

  override toDOM(): HTMLElement {
    return chipElement(this.names, this.form);
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** The rule a break draws, in place of the command it was written as. */
class Rule extends WidgetType {
  constructor(private readonly form: Form) {
    super();
  }

  override eq(other: Rule): boolean {
    return other.form === this.form;
  }

  override toDOM(): HTMLElement {
    return breakElement(this.form);
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * The editor extension a book's notes are drawn with. A note no book
 * lists takes no marks, so it is drawn as Obsidian draws it.
 */
export function runExtensions(marking: Marking): Extension[] {
  /** Reads the note again, for a note whose books changed under it. */
  const reread = StateEffect.define<void>();

  const read = (state: EditorState): readonly Drawn[] => {
    const note = state.field(editorInfoField, false)?.file?.path;
    if (note === undefined || !marking.member(note)) return [];
    return marksIn(state.doc.toString());
  };

  const marks = StateField.define<readonly Drawn[]>({
    create: read,
    update(held, tr) {
      if (tr.docChanged || tr.effects.some((effect) => effect.is(reread))) {
        return read(tr.state);
      }
      return held;
    },
  });

  return [
    marks,
    EditorView.decorations.compute([marks, "selection"], (state) =>
      decorations(state, state.field(marks)),
    ),
    ViewPlugin.define((view) => new Drawing(view, marking, () => view.dispatch({ effects: reread.of() }))),
  ];
}

/**
 * The decorations for a note's marks, with the cursor's own line left
 * as source. Live Preview shows the line the cursor is on as it was
 * written, and a chip is a mark like any other.
 */
function decorations(state: EditorState, marks: readonly Drawn[]): DecorationSet {
  const found: Placed[] = [];
  const open = new Set<number>();
  for (const range of state.selection.ranges) {
    open.add(state.doc.lineAt(range.head).number);
    open.add(state.doc.lineAt(range.anchor).number);
  }
  for (const mark of marks) {
    if (mark.to > state.doc.length) continue;
    if (mark.form === "setext") {
      found.push(...heading(state, mark));
      continue;
    }
    if (open.has(state.doc.lineAt(mark.from).number)) continue;
    if (mark.form === "pagebreak" || mark.form === "columnbreak") {
      found.push({
        from: mark.from,
        to: mark.to,
        value: Decoration.replace({ widget: new Rule(mark.form) }),
      });
      continue;
    }
    if (mark.form === "span" && mark.open !== undefined) {
      // The brackets come off with the run, so the words keep their
      // place. Obsidian colours what the brackets held the way it
      // colours a link, and the words are prose, so they read as it.
      found.push({ from: mark.open, to: mark.open + 1, value: Decoration.replace({}) });
      // A span with no words between its brackets marks nothing, and
      // an empty mark decoration is not a range CodeMirror takes.
      if (mark.open + 1 < mark.from - 1) {
        found.push({
          from: mark.open + 1,
          to: mark.from - 1,
          value: Decoration.mark({ class: "orca-span" }),
        });
      }
      found.push({ from: mark.from - 1, to: mark.from, value: Decoration.replace({}) });
    }
    if (mark.names === undefined) continue;
    found.push({
      from: mark.from,
      to: mark.to,
      value: Decoration.replace({ widget: new Chip(mark.names, mark.form) }),
    });
  }
  found.sort((one, two) => one.from - two.from || one.to - two.to);
  return Decoration.set(
    found.map(({ from, to, value }) => value.range(from, to)),
    true,
  );
}

/** The lines a setext heading is drawn over, and its underline. */
function heading(state: EditorState, mark: Drawn): Placed[] {
  const level = mark.level ?? 2;
  const found: Placed[] = [];
  const last = state.doc.lineAt(mark.from);
  const first = state.doc.lineAt(Math.min(mark.open ?? mark.from, state.doc.length));
  for (let line = first.number; line < last.number; line += 1) {
    const at = state.doc.line(line).from;
    found.push({
      from: at,
      to: at,
      value: Decoration.line({ class: `orca-setext orca-setext-${String(level)}` }),
    });
  }
  found.push({
    from: last.from,
    to: last.from,
    value: Decoration.line({ class: "orca-setext-under" }),
  });
  return found;
}

/**
 * Reads a note again when the books changed under it, or when the
 * pane turns to another note. The text's own changes are read by the
 * field, which the editor updates before it paints.
 */
class Drawing {
  private note: string | undefined;
  private readonly drop: () => void;

  constructor(
    view: EditorView,
    marking: Marking,
    private readonly again: () => void,
  ) {
    this.note = view.state.field(editorInfoField, false)?.file?.path;
    this.drop = marking.watch(() => {
      this.again();
    });
  }

  update(update: ViewUpdate): void {
    const note = update.state.field(editorInfoField, false)?.file?.path;
    if (note === this.note) return;
    this.note = note;
    // The pane turned to another note, and the field was made against
    // the one before it.
    this.again();
  }

  destroy(): void {
    this.drop();
  }
}
