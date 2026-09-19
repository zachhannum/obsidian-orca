/**
 * A book's notes as the writer has them: the chips the editor draws
 * over fleuron's attribute runs, and the headings it draws over a
 * setext underline.
 *
 * The marks come from the engine's parse of the note, which arrives
 * after the keystroke that changed it. A chip already on the text is
 * moved with the typing until the next parse lands, so a label does
 * not flicker off while the author writes.
 */

import {
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { offsetOf } from "@/book/place";
import type { Drawn, Form, Names } from "@/ui/runs";

/** The marks of one note, and the text the engine counted their bytes in. */
export interface Settled {
  /** The text the note last crossed to the engine as. */
  against: string;
  marks: readonly Drawn[];
}

/** The parse the editor draws a note from, as the plugin answers it. */
export interface Marking {
  /**
   * The marks of a note a book reads, counted in `against`. Nothing
   * for a note no book lists, and nothing while the engine holds
   * other text than `against`, because a mark is bytes of the text it
   * was read from.
   */
  marksIn(note: string, against: string): Promise<Settled | undefined>;
  /** Told when the book's parse of a note moved on, so the editor asks again. */
  watch(note: string, parsed: () => void): () => void;
}

/** A mark as it sits on the text now, moved with every edit since. */
class Mark extends RangeValue {
  constructor(readonly mark: Drawn) {
    super();
  }
  override eq(other: Mark): boolean {
    return other.mark === this.mark;
  }
}

/** Replaces every mark with the marks of a parse. */
const remark = StateEffect.define<RangeSet<Mark>>();

/**
 * The marks on the text. A parse replaces them; anything else moves
 * them with the edit, so a chip stays on its run while the author
 * types.
 */
const marks = StateField.define<RangeSet<Mark>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    for (const effect of tr.effects) if (effect.is(remark)) return effect.value;
    return set.map(tr.changes);
  },
});

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

/** The chip's own markup, which reading view draws too. */
export function chipElement(names: Names, form: Form): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "orca-run";
  chip.dataset["testid"] = "orca-run";
  chip.dataset["form"] = form;
  if (names.id === undefined && names.classes.length === 0) {
    const said = chip.createEl("em");
    said.setText(names.said);
    return chip;
  }
  if (names.id !== undefined) chip.createEl("b").setText(`#${names.id}`);
  for (const found of names.classes) chip.createEl("i").setText(`.${found}`);
  return chip;
}

/**
 * The decorations for the marks on the text, with the cursor's own
 * line left as source. Live Preview shows the line the cursor is on
 * as it was written, and a chip is a mark like any other.
 */
function decorations(state: EditorState): DecorationSet {
  const found: { from: number; to: number; value: Decoration }[] = [];
  const open = new Set<number>();
  for (const range of state.selection.ranges) {
    open.add(state.doc.lineAt(range.head).number);
    open.add(state.doc.lineAt(range.anchor).number);
  }
  for (let at = state.field(marks).iter(); at.value !== null; at.next()) {
    const { mark } = at.value;
    const from = Math.min(at.from, state.doc.length);
    const to = Math.min(at.to, state.doc.length);
    if (from > to) continue;
    if (mark.form === "setext") {
      found.push(...heading(state, mark, from, to));
      continue;
    }
    if (open.has(state.doc.lineAt(from).number)) continue;
    if (mark.names === undefined) continue;
    // A span run's brackets are the mark's own text too: the words
    // keep their place and the brackets around them come off.
    if (mark.form === "span" && mark.open !== undefined) {
      const bracket = Math.min(offsetOf(state.doc.toString(), mark.open), state.doc.length);
      found.push({ from: bracket, to: bracket + 1, value: Decoration.replace({}) });
    }
    found.push({
      from,
      to,
      value: Decoration.replace({ widget: new Chip(mark.names, mark.form) }),
    });
  }
  return Decoration.set(
    found.map(({ from, to, value }) => value.range(from, to)),
    true,
  );
}

/** The lines a setext heading is drawn over, and its underline. */
function heading(
  state: EditorState,
  mark: Drawn,
  from: number,
  to: number,
): { from: number; to: number; value: Decoration }[] {
  const level = mark.level ?? 2;
  const found: { from: number; to: number; value: Decoration }[] = [];
  const under = state.doc.lineAt(from);
  const opens = state.doc.lineAt(Math.min(mark.open ?? from, state.doc.length));
  for (let line = opens.number; line < under.number; line += 1) {
    const at = state.doc.line(line).from;
    found.push({
      from: at,
      to: at,
      value: Decoration.line({ class: `orca-setext orca-setext-${String(level)}` }),
    });
  }
  found.push({
    from: under.from,
    to: under.from,
    value: Decoration.line({ class: "orca-setext-under" }),
  });
  void to;
  return found;
}

/**
 * The transaction that puts a parse's marks on the text. The bytes
 * are counted in the text the note crossed to the engine as, so the
 * marks go on only while the editor holds that text. Otherwise the
 * author typed past the parse, and the marks already on the text stay
 * until the parse for the new text lands.
 */
export function marked(state: EditorState, settled: Settled): TransactionSpec | undefined {
  if (state.doc.toString() !== settled.against) return undefined;
  const ranges = settled.marks.map((mark) =>
    new Mark(mark).range(
      offsetOf(settled.against, mark.from),
      offsetOf(settled.against, mark.to),
    ),
  );
  return { effects: remark.of(RangeSet.of(ranges, true)) };
}

/**
 * The editor extension a book's notes are drawn with. A note no book
 * lists takes no marks, so it is drawn as Obsidian draws it.
 */
export function runExtensions(marking: Marking): Extension[] {
  return [
    marks,
    EditorView.decorations.compute([marks, "selection", "doc"], decorations),
    ViewPlugin.define((view) => new Drawing(view, marking)),
  ];
}

/** Asks the engine for a note's marks, and puts each answer on the text. */
class Drawing {
  private note: string | undefined;
  private asking = false;
  private again = false;
  private drop: (() => void) | undefined;

  constructor(
    private readonly view: EditorView,
    private readonly marking: Marking,
  ) {
    this.turned();
  }

  update(update: ViewUpdate): void {
    const note = update.state.field(editorInfoField, false)?.file?.path;
    if (note !== this.note) {
      this.turned();
      return;
    }
    if (update.docChanged) this.ask();
  }

  destroy(): void {
    this.drop?.();
  }

  /** Follows the note the pane now holds, and asks about it. */
  private turned(): void {
    const note = this.view.state.field(editorInfoField, false)?.file?.path;
    this.note = note;
    this.drop?.();
    this.drop = undefined;
    if (note !== undefined) {
      this.drop = this.marking.watch(note, () => {
        this.ask();
      });
    }
    this.ask();
  }

  private ask(): void {
    if (this.asking) {
      this.again = true;
      return;
    }
    this.asking = true;
    void this.asked().finally(() => {
      this.asking = false;
      if (this.again) {
        this.again = false;
        this.ask();
      }
    });
  }

  private async asked(): Promise<void> {
    const note = this.view.state.field(editorInfoField, false)?.file?.path;
    this.note = note;
    if (note === undefined) return;
    const against = this.view.state.doc.toString();
    const settled = await this.marking
      .marksIn(note, against)
      .catch(() => undefined);
    if (settled === undefined) return;
    const spec = marked(this.view.state, settled);
    if (spec !== undefined) this.view.dispatch(spec);
  }
}
