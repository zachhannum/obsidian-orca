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
import { chipElement } from "@/ui/chip";
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
  /**
   * The marks already settled for a note, without asking again.
   * Reading view draws a section the moment it is built, so a section
   * scrolled back into view is drawn from the parse already held.
   */
  marksNow(note: string, against: string): Settled | undefined;
  /** Told when the book's parse of a note moved on, so the editor asks again. */
  watch(note: string, parsed: () => void): () => void;
}

/**
 * The parts of a mark that move with the text: the run itself, a
 * bracket a span run closes, and the line a setext heading opens on.
 */
type Part = "run" | "bracket" | "head";

/** One part of a mark as it sits on the text now, moved with every edit since. */
class Mark extends RangeValue {
  constructor(
    readonly mark: Drawn,
    readonly part: Part,
  ) {
    super();
  }
  override eq(other: Mark): boolean {
    return other.mark === this.mark && other.part === this.part;
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
  const placed: { at: number; value: Mark }[] = [];
  for (let at = state.field(marks).iter(); at.value !== null; at.next()) {
    const from = Math.min(at.from, state.doc.length);
    if (from > Math.min(at.to, state.doc.length)) continue;
    placed.push({ at: from, value: at.value });
  }
  // A setext heading opens above its underline, and both places moved
  // with the text.
  const heads = new Map<Drawn, number>();
  for (const { at, value } of placed) {
    if (value.part === "head") heads.set(value.mark, at);
  }
  for (const { at, value } of placed) {
    const { mark, part } = value;
    if (part === "head") continue;
    if (mark.form === "setext") {
      found.push(...heading(state, mark, at, heads.get(mark) ?? at));
      continue;
    }
    if (open.has(state.doc.lineAt(at).number)) continue;
    const to = Math.min(at + (mark.to - mark.from), state.doc.length);
    // The bracket a span run closes comes off with the run, so the
    // words keep their place and the brackets around them do not.
    if (part === "bracket") {
      found.push({ from: at, to: at + 1, value: Decoration.replace({}) });
      continue;
    }
    if (mark.names === undefined) continue;
    found.push({
      from: at,
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
  under: number,
  opens: number,
): { from: number; to: number; value: Decoration }[] {
  const level = mark.level ?? 2;
  const found: { from: number; to: number; value: Decoration }[] = [];
  const last = state.doc.lineAt(under);
  const first = state.doc.lineAt(Math.min(opens, state.doc.length));
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
 * The transaction that puts a parse's marks on the text. The bytes
 * are counted in the text the note crossed to the engine as, so the
 * marks go on only while the editor holds that text. Otherwise the
 * author typed past the parse, and the marks already on the text stay
 * until the parse for the new text lands.
 */
export function marked(state: EditorState, settled: Settled): TransactionSpec | undefined {
  if (state.doc.toString() !== settled.against) return undefined;
  const ranges = settled.marks.flatMap((mark) => {
    const from = offsetOf(settled.against, mark.from);
    const found = [new Mark(mark, "run").range(from, offsetOf(settled.against, mark.to))];
    if (mark.open === undefined) return found;
    const opens = offsetOf(settled.against, mark.open);
    // A setext heading opens above its underline, and the line it
    // opens on moves with the text like the underline does.
    if (mark.form === "setext") {
      return [new Mark(mark, "head").range(opens, opens), ...found];
    }
    if (mark.form !== "span") return found;
    // The run sat directly after the `]`, so the bracket that closes
    // the text is the character before the run.
    return [
      new Mark(mark, "bracket").range(opens, opens + 1),
      new Mark(mark, "bracket").range(from - 1, from),
      ...found,
    ];
  });
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
