/**
 * The editor over the book's own CSS. It is CodeMirror as Obsidian
 * ships it, so every package here but the CSS grammar is Obsidian's
 * instance and nothing is bundled twice. CodeMirror owns its DOM, so
 * the editor sits beside the React panel and never inside it.
 */

import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cssLanguage } from "@codemirror/lang-css";
import {
  bracketMatching,
  ensureSyntaxTree,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Range,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  GutterMarker,
  gutterLineClass,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  runScopeHandlers,
  lineNumbers,
  rectangularSelection,
  tooltips,
  type DecorationSet,
  type MouseSelectionStyle,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { SUBSET } from "fleuron";
import { classHighlighter } from "@lezer/highlight";
import type { Named } from "@/book/names";
import type { Place } from "@/style/origin";
import { quoted } from "@/style/quoted";
import { searchPanel } from "@/ui/search";

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
  /** Puts text in at the caret, as typing does, so it reaches the note. */
  insert(text: string): void;
  /** Sets the families a `font-family` value completes from. See {@link fontCompletion}. */
  fonts(families: readonly string[]): void;
  /** Sets the sections a selector completes from. See {@link selectorCompletion}. */
  sections(named: readonly Named[]): void;
  /** The line and column of the caret, both counted from 1. */
  caret(): { line: number; column: number };
  /** The warnings inside the rule that starts at a line and column. */
  skipped(line: number, column: number): Skipped[];
  /**
   * Runs the editor's own binding for a key with a modifier pressed
   * inside it, and answers whether one took the key. Obsidian's hotkeys
   * see a key before the editor does, so the view asks here first.
   */
  keydown(event: KeyboardEvent): boolean;
  destroy(): void;
}

/** A declaration the engine refused, split at its colon, with the engine's warning. */
export interface Skipped {
  property: string;
  /** The text after the colon, without its semicolon. Nothing when the flagged text has no colon. */
  value: string | undefined;
  message: string;
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

/** Replaces the families a `font-family` value completes from. */
const refamilies = StateEffect.define<readonly string[]>();

const families = StateField.define<readonly string[]>({
  create: () => [],
  update(names, tr) {
    for (const effect of tr.effects) if (effect.is(refamilies)) return effect.value;
    return names;
  },
});

/** The transaction that sets the families a `font-family` value completes from. */
export function fonted(names: readonly string[]): TransactionSpec {
  return { effects: refamilies.of(names) };
}

/** Replaces the sections a selector completes from. */
const renamed = StateEffect.define<readonly Named[]>();

const sectionNamed = StateField.define<readonly Named[]>({
  create: () => [],
  update(named, tr) {
    for (const effect of tr.effects) if (effect.is(renamed)) return effect.value;
    return named;
  },
});

/** The transaction that sets the sections a selector completes from. */
export function sectioned(named: readonly Named[]): TransactionSpec {
  return { effects: renamed.of(named) };
}

/** The `font-family` value being written, and the text typed into it so far. */
interface Naming {
  from: number;
  to: number;
  typed: string;
}

/**
 * The families the book registers, offered inside a `font-family`
 * value and nowhere else. A name goes in quoted, so one of several
 * words reads as one family.
 */
export function fontCompletion(context: CompletionContext): CompletionResult | null {
  const at = naming(context.state, context.pos);
  if (at === undefined) return null;
  const typed = at.typed.replace(/^["']/, "").trim().toLowerCase();
  const offered = context.state
    .field(families)
    .filter((name) => name.toLowerCase().includes(typed));
  if (offered.length === 0) return null;
  return {
    from: at.from,
    to: at.to,
    // The typed text can open with a quote, which matches no family
    // name, so the options are filtered here rather than by the label.
    filter: false,
    options: offered.map((name) => ({
      label: name,
      type: "constant",
      apply: quoted(name),
    })),
  };
}

/**
 * The extent of the one family a place in the text is writing, or
 * nothing where that place is not in a `font-family` value. A comma
 * splits a stack, so only the family under the caret is replaced.
 */
function naming(state: EditorState, pos: number): Naming | undefined {
  let back = pos;
  while (back > 0 && /\s/.test(state.sliceDoc(back - 1, back))) back -= 1;
  const inner = syntaxTree(state).resolveInner(back, -1);
  let node: SyntaxNode | null = inner;
  while (node !== null && node.name !== "Declaration") node = node.parent;
  if (node === null) return undefined;
  const property = node.getChild("PropertyName");
  const colon = node.getChild(":");
  if (property === null || colon === null || pos < colon.to) return undefined;
  if (state.sliceDoc(property.from, property.to).trim().toLowerCase() !== "font-family") {
    return undefined;
  }
  let from = colon.to;
  const comma = state.sliceDoc(from, pos).lastIndexOf(",");
  if (comma >= 0) from += comma + 1;
  while (from < pos && /\s/.test(state.sliceDoc(from, from + 1))) from += 1;
  let to = pos;
  // A quoted name is replaced whole, quotes and all, so the completion
  // never leaves a stray quote behind it.
  if (inner.name === "StringLiteral" && inner.from <= from) {
    from = inner.from;
    to = Math.max(to, inner.to);
  }
  return { from, to, typed: state.sliceDoc(from, pos) };
}

/** The part of a rule a place in the text is in. */
type Spot =
  | { in: "selector"; statement: string }
  | { in: "name"; block: Block }
  | { in: "value"; block: Block; property: string };

/** The block a declaration sits in, which sets the names it can declare. */
type Block = "style" | "page" | "margin" | "face";

/** One name a block declares, with the values it takes. */
interface Declared {
  name: string;
  syntax: string;
  keywords: readonly string[];
}

/**
 * The part of a rule a place in the text is in, or nothing inside a
 * comment, a string or a block the engine does not read. The braces
 * before the place decide, because the grammar reads a half-typed value
 * such as `color: #ff` as a selector while its rule is not closed.
 */
function spot(state: EditorState, pos: number): Spot | undefined {
  const node = syntaxTree(state).resolveInner(pos, -1);
  if (node.name === "Comment" || node.name === "StringLiteral") return undefined;
  const before = state
    .sliceDoc(0, pos)
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, "")
    .replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  const open: string[] = [];
  let start = 0;
  for (let at = 0; at < before.length; at += 1) {
    const char = before[at];
    if (char === "{") open.push(before.slice(start, at).trim());
    else if (char === "}") open.pop();
    else if (char !== ";") continue;
    start = at + 1;
  }
  const statement = before.slice(start);
  const prelude = open.at(-1);
  if (prelude === undefined) return { in: "selector", statement };
  const block = blockOf(prelude);
  if (block === undefined) return undefined;
  const colon = statement.indexOf(":");
  if (colon < 0) return { in: "name", block };
  return { in: "value", block, property: statement.slice(0, colon).trim().toLowerCase() };
}

/** The block a prelude opens, or nothing for an at-rule the engine does not read. */
function blockOf(prelude: string): Block | undefined {
  const at = /^@([-\w]+)/.exec(prelude)?.[1]?.toLowerCase();
  if (at === undefined) return "style";
  if (at === "page") return "page";
  if (at === "font-face") return "face";
  return SUBSET.page.margin_boxes.some((box) => box.name === at) ? "margin" : undefined;
}

/** The names a block declares, from the engine's own subset. */
function declared(block: Block): readonly Declared[] {
  switch (block) {
    case "style":
      return SUBSET.properties;
    case "page":
      return SUBSET.page.properties;
    case "margin":
      return [
        ...SUBSET.properties.filter(
          (each) => !SUBSET.page.margin_box_properties.some((own) => own.name === each.name),
        ),
        ...SUBSET.page.margin_box_properties,
      ];
    case "face":
      return SUBSET.font_face.descriptors;
  }
}

/**
 * The names the block at the caret declares, from the subset of the
 * pinned engine. An `@page` body also opens the margin boxes the engine
 * draws. A box it reads and drops is not offered.
 */
export function propertyCompletion(context: CompletionContext): CompletionResult | null {
  const at = spot(context.state, context.pos);
  if (at?.in !== "name") return null;
  const word = context.matchBefore(/@?[-\w]*$/);
  if (word === null || (word.from === word.to && !context.explicit)) return null;
  const options: Completion[] = declared(at.block).map((each) => ({
    label: each.name,
    type: "property",
    detail: each.syntax,
  }));
  if (at.block === "page") {
    for (const box of SUBSET.page.margin_boxes) {
      if (box.paints) options.push({ label: `@${box.name}`, type: "keyword" });
    }
  }
  return { from: word.from, options, validFor: /^@?[-\w]*$/ };
}

/**
 * The values the property at the caret accepts, from the subset of the
 * pinned engine: its keywords, the colour names where it takes a
 * colour, the page sizes and counter styles where it takes them, the
 * functions its syntax names, and `var()`, which any value takes. A
 * function goes in open, with the caret inside it.
 */
export function valueCompletion(context: CompletionContext): CompletionResult | null {
  const at = spot(context.state, context.pos);
  if (at?.in !== "value") return null;
  const property = declared(at.block).find((each) => each.name === at.property);
  if (property === undefined) return null;
  const word = context.matchBefore(/[-\w]*$/);
  if (word === null) return null;
  if (namedIn(context.state, word.from) !== undefined) return null;
  // A word after `#` is a hex colour and one after a digit is a unit.
  if (/[#\d.]$/.test(context.state.sliceDoc(word.from - 1, word.from))) return null;
  const { syntax } = property;
  const options: Completion[] = property.keywords.map((keyword) => ({
    label: keyword,
    type: "keyword",
  }));
  if (syntax.includes("<color>")) {
    for (const name of SUBSET.color_names) options.push({ label: name, type: "constant" });
  }
  if (syntax.includes("<page-size>")) {
    for (const size of SUBSET.page.sizes) options.push({ label: size.name, type: "constant" });
  }
  if (syntax.includes("<counter-style>")) {
    for (const name of SUBSET.page.counter_styles) options.push({ label: name, type: "constant" });
  }
  for (const name of new Set(syntax.match(/[a-z][-a-z]*(?=\()/g))) {
    options.push({ label: `${name}()`, type: "function", apply: `${name}(`, detail: syntax });
  }
  options.push({ label: "var()", type: "function", apply: "var(", detail: SUBSET.var });
  return { from: word.from, options, validFor: /^[-\w]*$/ };
}

/** The function the text before a place opens, when a name the sheet defines goes there. */
function namedIn(state: EditorState, pos: number): "var" | "string" | undefined {
  const opened = /\b(var|string)\(\s*$/i.exec(state.sliceDoc(Math.max(0, pos - 64), pos));
  return opened?.[1]?.toLowerCase() as "var" | "string" | undefined;
}

/**
 * The names the sheet defines, offered inside the function that reads
 * them: a custom property inside `var(`, and a name a `string-set`
 * sets inside `string(`. A name counts wherever the sheet defines it,
 * because the engine reads the whole sheet before it resolves either.
 */
export function namedCompletion(context: CompletionContext): CompletionResult | null {
  const at = spot(context.state, context.pos);
  if (at?.in !== "value") return null;
  const word = context.matchBefore(/[-\w]*$/);
  if (word === null) return null;
  const inside = namedIn(context.state, word.from);
  if (inside === undefined) return null;
  const sheet = context.state.doc
    .toString()
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, "")
    .replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  const names = new Set<string>();
  if (inside === "var") {
    for (const [, name] of sheet.matchAll(/(?:^|[{;\s])(--[-\w]+)\s*:/g)) {
      if (name !== undefined) names.add(name);
    }
  } else {
    for (const [, list] of sheet.matchAll(/(?:^|[{;\s])string-set\s*:([^;}]*)/gi)) {
      for (const part of list?.split(",") ?? []) {
        const name = /^\s*([-\w]+)/.exec(part)?.[1];
        if (name !== undefined && name.toLowerCase() !== "none") names.add(name);
      }
    }
  }
  if (names.size === 0) return null;
  const type = inside === "var" ? "variable" : "constant";
  const options = [...names].map((label) => ({ label, type }));
  return { from: word.from, options, validFor: /^[-\w]*$/ };
}

/**
 * The selectors the engine reads, offered where a selector is written:
 * the elements the content tree makes, the pseudo-classes and
 * pseudo-elements, the at-rules and an `@page` rule's page selectors. A
 * class is a role that some section has, and an id is one that the
 * engine gets.
 */
export function selectorCompletion(context: CompletionContext): CompletionResult | null {
  const at = spot(context.state, context.pos);
  if (at?.in !== "selector") return null;
  const word = context.matchBefore(/(::?|[.#@])?[-\w]*$/);
  if (word === null || (word.from === word.to && !context.explicit)) return null;
  const page = /^\s*@page\b/i.test(at.statement);
  const lead = /^(::?|[.#@])?/.exec(word.text)?.[0] ?? "";
  // An at-rule opens a statement, and nothing else follows `@`.
  if (lead === "@" && at.statement.trim() !== word.text) return null;
  if (page && lead !== ":") return null;
  if (at.statement.trimStart().startsWith("@") && !page && lead !== "@") return null;
  const named = context.state.field(sectionNamed);
  const options: Completion[] = page
    ? SUBSET.page.selectors.map((name) => ({ label: `:${name}`, type: "keyword" }))
    : optionsAfter(lead, named);
  if (options.length === 0) return null;
  return { from: word.from, options, validFor: /^(::?|[.#@])?[-\w]*$/ };
}

/** The selector options a lead character opens. */
function optionsAfter(lead: string, named: readonly Named[]): Completion[] {
  switch (lead) {
    case "@":
      return ["@page", "@font-face"].map((label) => ({ label, type: "keyword" }));
    case "::":
      return SUBSET.selectors.pseudo_elements.map(({ name }) => ({ label: name, type: "keyword" }));
    case ":":
      return [
        ...SUBSET.selectors.pseudo_classes.map(({ name }) => ({
          label: name,
          type: "keyword",
          apply: name.replace(/\)$/, ""),
        })),
        ...SUBSET.selectors.pseudo_elements.map(({ name }) => ({ label: name, type: "keyword" })),
      ];
    case ".":
      return [...new Set(named.map((each) => each.role))].map((role) => ({
        label: `.${role}`,
        type: "class",
      }));
    case "#":
      return named.map((each) => ({ label: `#${each.id}`, type: "class", detail: each.role }));
    default:
      return SUBSET.selectors.elements.map((name) => ({ label: name, type: "type" }));
  }
}

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

/** Draws an Obsidian icon into an element. */
export type DrawIcon = (el: HTMLElement, name: string) => void;

/** The Obsidian icon each kind of completion shows. */
const COMPLETION_ICONS: Readonly<Record<string, string>> = {
  property: "sliders-horizontal",
  keyword: "tag",
  constant: "diamond",
  function: "parentheses",
  type: "code",
  class: "hash",
  variable: "variable",
};

/** An option's icon, drawn by Obsidian in place of CodeMirror's own glyph. */
function completionIcons(draw: DrawIcon): Parameters<typeof autocompletion>[0] {
  return {
    icons: false,
    addToOptions: [
      {
        // CodeMirror puts its own icon at 20, before the label.
        position: 20,
        render(completion, _state, view) {
          const el = view.dom.ownerDocument.createElement("div");
          el.className = "orca-completion-icon";
          const name = COMPLETION_ICONS[completion.type ?? ""];
          if (name !== undefined) draw(el, name);
          return el;
        },
      },
    ],
  };
}

/**
 * The editor's extensions: the CSS grammar, the engine's warnings on
 * the text, and completion from the engine's subset, the book's
 * families and its sections' classes and ids. Nothing here
 * lints. Every flag comes from a render, because the engine is the only
 * linter.
 */
export function cssExtensions(changed: (css: string) => void, icon?: DrawIcon): Extension[] {
  return [
    cssLanguage,
    families,
    sectionNamed,
    autocompletion({
      override: [
        fontCompletion,
        propertyCompletion,
        valueCompletion,
        namedCompletion,
        selectorCompletion,
      ],
      tooltipClass: () => "orca-completion",
      ...(icon === undefined ? {} : completionIcons(icon)),
    }),
    Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
    syntaxHighlighting(classHighlighter),
    lineNumbers(),
    foldGutter({ markerDOM: foldMarker }),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    altSelection,
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    highlightSelectionMatches(),
    search({ top: true, createPanel: searchPanel }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
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

/** The syntax nodes that are one whole rule, at-rules included. */
const RULE = /^(RuleSet|AtRule|\w+Statement)$/;

/**
 * The text of the rule that starts at a line and column. Both count from
 * 1, as in a matched rule from the engine. The text is of the innermost
 * rule that holds that place. A place outside every rule gives nothing.
 */
export function ruleExtent(
  state: EditorState,
  line: number,
  column: number,
): { from: number; to: number } | undefined {
  if (line < 1 || line > state.doc.lines) return undefined;
  const at = state.doc.line(line);
  const from = Math.min(at.from + Math.max(column - 1, 0), at.to);
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  for (let node = tree.resolveInner(from, 1); ; ) {
    if (RULE.test(node.name)) return { from: node.from, to: node.to };
    const parent = node.parent;
    if (parent === null) return undefined;
    node = parent;
  }
}

/**
 * The flags on the text inside the rule that starts at a line and
 * column. The engine leaves a declaration it refused out of its matched
 * rule, so the pane shows it from here, with the engine's own words.
 */
export function skippedIn(state: EditorState, line: number, column: number): Skipped[] {
  const extent = ruleExtent(state, line, column);
  if (extent === undefined) return [];
  return flagsIn(state)
    .filter((found) => found.from >= extent.from && found.to <= extent.to)
    .map((found) => {
      const text = state.sliceDoc(found.from, found.to).trim().replace(/;$/, "");
      const colon = text.indexOf(":");
      return colon < 0
        ? { property: text, value: undefined, message: found.message }
        : {
            property: text.slice(0, colon).trim(),
            value: text.slice(colon + 1).trim(),
            message: found.message,
          };
    });
}

/**
 * The transaction that puts text in at the caret, on lines of its own,
 * with the caret on the line after the text's last `{`. It carries no
 * annotation, so the change reaches the note as typing does.
 */
export function inserted(state: EditorState, text: string): TransactionSpec {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const before = state.sliceDoc(line.from, head).trim() === "" ? "" : "\n";
  const after = state.sliceDoc(head, line.to).trim() === "" ? "" : "\n";
  const open = text.lastIndexOf("{");
  let inside = text.length;
  if (open >= 0) {
    const next = text.indexOf("\n", open);
    const end = next < 0 ? -1 : text.indexOf("\n", next + 1);
    inside = next < 0 ? Math.min(open + 2, text.length) : end < 0 ? text.length : end;
  }
  const pos = head + before.length + inside;
  return {
    changes: { from: head, insert: `${before}${text}${after}` },
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
    userEvent: "input",
  };
}

/** Lucide's chevrons, which Obsidian draws its own fold markers with. */
const FOLD_PATHS = { open: "m6 9 6 6 6-6", folded: "m9 18 6-6-6-6" };

function foldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("div");
  marker.className = "orca-editor-fold";
  marker.dataset["testid"] = open ? "orca-editor-fold" : "orca-editor-folded";
  const svg = marker.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg
    .appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path"))
    .setAttribute("d", open ? FOLD_PATHS.open : FOLD_PATHS.folded);
  return marker;
}

/** The mouse style CodeMirror's rectangular selection uses for an `Alt` drag. */
const rectangle = EditorState.create({ extensions: rectangularSelection() }).facet(
  EditorView.mouseSelectionStyle,
)[0];

/**
 * `Alt`-click adds a cursor to the ones already there, and `Alt`-drag
 * makes a rectangular selection in place of them.
 */
const altSelection = EditorView.mouseSelectionStyle.of((view, event) => {
  const style = rectangle?.(view, event);
  if (style === undefined || style === null) return null;
  const before = view.state.selection;
  const added: MouseSelectionStyle = {
    update: (update) => {
      style.update(update);
    },
    get(moved, extend) {
      const drawn = style.get(moved, extend, false);
      const clicked = drawn.ranges.length === 1 && drawn.main.empty;
      return clicked
        ? EditorSelection.create([...before.ranges, drawn.main], before.ranges.length)
        : drawn;
    },
  };
  return added;
});

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
  card.className = "orca-card";
  card.dataset["testid"] = "orca-editor-card";
  for (const found of here) {
    const row = card.appendChild(document.createElement("div"));
    row.className = "orca-card-row mod-warning";

    const svg = row.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    svg.setAttribute("class", "orca-card-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const d of WARNING_PATHS) {
      svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path")).setAttribute("d", d);
    }

    const body = row.appendChild(document.createElement("div"));
    body.className = "orca-card-body";
    const said = body.appendChild(document.createElement("div"));
    said.className = "orca-card-said";
    said.textContent = found.message;
    const line = view.state.doc.lineAt(found.from);
    const at = body.appendChild(document.createElement("div"));
    at.className = "orca-card-at";
    at.textContent = `${found.sheet}:${String(line.number)}:${String(found.from - line.from + 1)}`;
  }
  return card;
}

/** Mounts the editor under an element the view owns. */
export function mountEditor(
  parent: HTMLElement,
  css: string,
  icon: DrawIcon,
  changed: (css: string) => void,
  moved: () => void = () => undefined,
): CssEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: css,
      extensions: [
        ...cssExtensions(changed, icon),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) moved();
        }),
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
    insert(text) {
      view.dispatch(inserted(view.state, text));
      view.focus();
    },
    fonts(names) {
      view.dispatch(fonted(names));
    },
    sections(named) {
      view.dispatch(sectioned(named));
    },
    caret() {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return { line: line.number, column: head - line.from + 1 };
    },
    skipped(line, column) {
      return skippedIn(view.state, line, column);
    },
    keydown(event) {
      // A bare key goes to the editor already, and Tab after Escape
      // must reach its own handling to leave the editor.
      if (!event.ctrlKey && !event.metaKey && !event.altKey) return false;
      const target = event.target as Node | null;
      if (view.contentDOM.contains(target)) return runScopeHandlers(view, event, "editor");
      if (view.dom.contains(target)) return runScopeHandlers(view, event, "search-panel");
      return false;
    },
    destroy() {
      view.destroy();
    },
  };
}
