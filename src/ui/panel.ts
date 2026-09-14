import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Family, FontIndex } from "@/assets/fonts";
import {
  designFonts,
  designUses,
  type Design,
  type FontUse,
  type PageUnit,
  type Written,
} from "@/style/design";
import type { Place } from "@/style/origin";
import type { Typeset } from "@/ui/composer";
import { mountEditor, type CssEditor } from "@/ui/editor";
import type { Pin } from "@/ui/inspect";
import { Settled } from "@/ui/settled";
import { groupRules } from "@/style/layers";
import type { ResolvedUse } from "@/ui/fonts";
import { controlOf, withFont, withKey, withVariant } from "@/ui/groups";
import type { Inspecting } from "@/ui/pane";
import { missingFont, missingFonts, missingVariants } from "@/ui/picker";
import { mountPanel, type Mounted, type Shown, type Viewing } from "@/ui/panels";
import { cssFlags } from "@/ui/warnings";

/** The type the design panel is registered under. */
export const PANEL_VIEW = "orca-design";

/** The book the panel designs and the fonts the machine has. */
export interface Designing {
  /** The book the panel designs, which is the one being read. */
  book(): Promise<Typeset | undefined>;
  /** Writes the design into the book's own frontmatter, where it lives. */
  setDesign(book: string, design: Design): Promise<void>;
  /** Writes the author's own CSS into the book note's css fence. */
  setCss(book: string, css: string): Promise<void>;
  /** The fonts the machine has. The scan runs once for the session. */
  index(): Promise<FontIndex>;
  /** The faces of each font and variant, as the bytes that cross and the rules that register them. */
  fonts(uses: readonly FontUse[]): Promise<readonly ResolvedUse[]>;
  /** Registers one face of each variant of a family with the document, so each variant row draws in it. */
  preview(family: Family): Promise<void>;
  /** The unit the author measures pages in, from orca's settings. */
  unit(): PageUnit;
  /** Takes the pin off in every preview. */
  unpin(): void;
  /** Told when the book being designed changes. */
  watch(again: () => void): () => void;
}

/**
 * The design panel. It holds no settings of its own. An edit goes to
 * the book the engine holds, and the panel paints from what the engine
 * returned.
 */
export class DesignPanelView extends ItemView {
  private mounted: Mounted | undefined;
  private watching: (() => void) | undefined;
  /** The last pick whose files would not read. The panel warns about it. */
  private unread: string | undefined;
  /** Counts the paints, so a scan that lands late does not overwrite a later one. */
  private painting = 0;
  /** The fonts the machine has, once the first scan lands. */
  private index: FontIndex | undefined;
  /** The view the panel shows: the controls, or the author's own CSS. */
  private viewing: Viewing = "controls";
  /** Whether the CSS view wraps long lines. It scrolls them sideways until the author asks. */
  private wrapping = false;
  /** The book last painted, which an edit in the CSS view goes to. */
  private showing: Typeset | undefined;
  /** The element CodeMirror draws in, beside the React root and never under it. */
  private editorHost: HTMLElement | undefined;
  private editor: CssEditor | undefined;
  /** The box pinned in the preview, which the inspect pane shows. */
  private pinned: Pin | undefined;
  private readonly writes = new Settled((book, css) => {
    void this.designing.setCss(book, css);
  });

  constructor(
    leaf: WorkspaceLeaf,
    private readonly designing: Designing,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PANEL_VIEW;
  }

  override getDisplayText(): string {
    return "Design";
  }

  override getIcon(): string {
    return "sliders-horizontal";
  }

  override onOpen(): Promise<void> {
    this.mounted = mountPanel(this.contentEl, {
      pick: (family, key) => {
        void this.pick(family, key);
      },
      set: (key, value) => {
        void this.set(key, value);
      },
      variant: (key, variant) => {
        void this.redesign(key, (design) => withVariant(design, key, variant));
      },
      preview: (family) => {
        void this.designing.preview(family);
      },
      view: (viewing) => {
        this.view(viewing);
      },
      wrap: (on) => {
        this.wrapping = on;
        this.editor?.wrap(on);
        this.refresh();
      },
      cursor: (line, column) => {
        this.editor?.reveal(line, column);
      },
      add: (text) => {
        this.editor?.insert(text);
      },
      unpin: () => {
        this.designing.unpin();
      },
    });
    this.contentEl.addClass("orca-design");
    this.editorHost = this.contentEl.createDiv({
      cls: "orca-editor-host",
      attr: { "data-testid": "orca-editor" },
    });
    this.editorHost.hidden = true;
    this.register(
      this.designing.watch(() => {
        this.refresh();
      }),
    );
    this.refresh();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    this.watching?.();
    this.watching = undefined;
    this.mounted?.unmount();
    this.mounted = undefined;
    this.writes.flush();
    this.editor?.destroy();
    this.editor = undefined;
    this.editorHost?.remove();
    this.editorHost = undefined;
    this.showing = undefined;
    return Promise.resolve();
  }

  /** Switches between the controls and the author's own CSS. The book stays in the pane. */
  private view(viewing: Viewing): void {
    this.viewing = viewing;
    this.refresh();
  }

  /**
   * Sets the book under the author's CSS and writes it into the fence.
   * The engine gets the sheet at once, and the note's write settles.
   */
  private recss(css: string): void {
    const typeset = this.showing;
    if (typeset === undefined) return;
    typeset.recss(css);
    this.writes.put(typeset.path, css);
  }

  /** Shows the editor in the CSS view with the CSS of the book painted, and hides it otherwise. */
  private edit(typeset: Typeset | undefined): void {
    this.showing = typeset;
    const host = this.editorHost;
    if (host === undefined) return;
    const shown = typeset !== undefined && this.viewing === "css";
    this.contentEl.toggleClass("is-css", shown);
    host.hidden = !shown;
    if (!shown) return;
    let editor = this.editor;
    if (editor === undefined) {
      editor = mountEditor(
        host,
        typeset.css,
        (css) => {
          this.recss(css);
        },
        () => {
          this.moved();
        },
      );
      editor.wrap(this.wrapping);
      this.editor = editor;
    } else editor.show(typeset.css);
    editor.flag(cssFlags(typeset.session.warnings), typeset.cssWarned);
  }

  /**
   * Sends the faces of the font's default variant and sets the book in
   * it. A variant picked for the font before goes with the old font. The
   * registry keys faces by content, so picking the font again sends the
   * sheets alone.
   *
   * A file that has gone since the scan still names its font in the
   * design. The engine sets the book in the one it carries, and the
   * panel warns that the font asked for is missing.
   */
  private async pick(font: Family, key: string): Promise<void> {
    const typeset = await this.designing.book();
    if (typeset === undefined) return;
    const design = withFont(typeset.design, key, font.name);
    const resolved = await this.resolve(design);
    const want = font.name.toLowerCase();
    this.unread = resolved.some((each) => each.unread && each.use.font.toLowerCase() === want)
      ? font.name
      : undefined;
    await this.settle(typeset, design, resolved);
  }

  /** Sets the book under the design with one key changed, and writes that design. Clearing a font clears its variant too. */
  private async set(key: string, value: Written | undefined): Promise<void> {
    await this.redesign(key, (design) =>
      key.endsWith("-font") ? withFont(design, key, value?.toString()) : withKey(design, key, value),
    );
  }

  /** Sets the book under one edit to its design. An edit to a font or a variant sends the faces the design now uses. */
  private async redesign(key: string, edited: (design: Design) => Design): Promise<void> {
    const typeset = await this.designing.book();
    if (typeset === undefined) return;
    const design = edited(typeset.design);
    const fonted = key.endsWith("-font") || key.endsWith("-font-variant");
    await this.settle(typeset, design, fonted ? await this.resolve(design) : []);
  }

  /** The faces of every font and variant a design uses. A read that fails sends none. */
  private async resolve(design: Design): Promise<readonly ResolvedUse[]> {
    const uses = designUses(design);
    if (uses.length === 0) return [];
    try {
      return await this.designing.fonts(uses);
    } catch {
      return [];
    }
  }

  /**
   * Sets the book under a design and writes that design into the note.
   * It edits the design the engine holds, so two edits in a row keep the
   * first.
   *
   * The engine gets the sheets before orca writes the note, so the
   * pages do not wait for the save.
   */
  private async settle(
    typeset: Typeset,
    design: Design,
    resolved: readonly ResolvedUse[],
  ): Promise<void> {
    typeset.restyle(design, resolved);
    await this.repaint();
    await this.designing.setDesign(typeset.path, design);
  }

  /** The box pinned in the preview, for the inspect pane. */
  get inspected(): Pin | undefined {
    return this.pinned;
  }

  /**
   * Takes the box pinned in the preview, or nothing once the pin comes
   * off. A pin turns the panel to its CSS view.
   */
  inspect(pin: Pin | undefined): void {
    this.pinned = pin;
    if (pin !== undefined) this.viewing = "css";
    this.refresh();
  }

  /** Opens the author's CSS with the caret at the place a warning named. */
  async reveal(place: Place): Promise<void> {
    this.viewing = "css";
    await this.repaint();
    this.editor?.reveal(place.line, place.column);
  }

  /**
   * Paints the panel again. The leaf is in the sidebar from startup, so
   * the book it designs arrives long after it opened.
   */
  refresh(): void {
    void this.repaint();
  }

  /** Paints the panel for the book being read, and the index behind it. */
  private async repaint(): Promise<void> {
    const run = (this.painting += 1);
    const mounted = this.mounted;
    if (mounted === undefined) return;
    const typeset = await this.designing.book();
    if (run !== this.painting) return;
    if (typeset === undefined) {
      this.edit(undefined);
      mounted.paint({ kind: "none" });
      return;
    }
    // The first scan reads every font directory on the machine, so the
    // panel shows a reading notice rather than an empty list. Only the
    // first paint shows it. A notice over the rows on every edit takes
    // the author's scroll back to the top.
    if (this.index === undefined) mounted.paint({ kind: "reading" });
    const index = await this.designing.index();
    this.index = index;
    if (run !== this.painting) return;
    this.watch(typeset);
    // The editor goes first, so the pane reads the flags of this render.
    this.edit(typeset);
    mounted.paint(this.shownFor(typeset, index));
  }

  /** Paints the pane again when the caret moves, so it shows the line where a new rule goes. */
  private moved(): void {
    const { mounted, showing, index, pinned } = this;
    if (mounted === undefined || showing === undefined || index === undefined) return;
    if (pinned === undefined) return;
    mounted.paint(this.shownFor(showing, index));
  }

  /** Follows the book's renders, so the styles appear as the engine returns them. */
  private watch(typeset: Typeset): void {
    this.watching?.();
    this.watching = typeset.watch(() => {
      void this.painted(typeset);
    });
  }

  private async painted(typeset: Typeset): Promise<void> {
    const mounted = this.mounted;
    if (mounted === undefined) return;
    const index = await this.designing.index();
    this.edit(typeset);
    mounted.paint(this.shownFor(typeset, index));
  }

  /** The panel's state for one book, from the engine and the index. */
  private shownFor(typeset: Typeset, index: FontIndex): Shown {
    return {
      kind: "book",
      viewing: this.viewing,
      wrapping: this.wrapping,
      name: typeset.name,
      design: typeset.design,
      index,
      unit: this.designing.unit(),
      language: typeset.language,
      missing: this.warnings(index, typeset.design),
      warned: cssFlags(typeset.session.warnings).length,
      inspecting: this.inspecting(typeset),
    };
  }

  /**
   * The pinned box as the pane draws it. A design panel rule names the
   * control that wrote it, and an author's rule carries the flags the
   * editor holds inside it.
   */
  private inspecting(typeset: Typeset): Inspecting | undefined {
    const pin = this.pinned;
    if (pin === undefined) return undefined;
    const editor = this.editor;
    const layers = groupRules(pin.inspection.rules).map(({ layer, rules }) => ({
      layer,
      rules: rules.map((rule) => {
        const from = layer === "design" ? typeset.ruleAt(rule.line) : undefined;
        return {
          rule,
          owner: from === undefined ? undefined : controlOf(from),
          skipped:
            layer === "own" && editor !== undefined
              ? editor.skipped(rule.line, rule.column)
              : [],
        };
      }),
    }));
    return { pin, layers, caret: editor?.caret().line };
  }

  /** The warnings for the fonts and variants a design asks for, the body's and each heading level's. */
  private warnings(index: FontIndex, design: Design): string[] {
    const unread = this.unread;
    const missing = [...missingFonts(index, design), ...missingVariants(index, design)];
    if (unread === undefined || !designFonts(design).includes(unread)) {
      return missing;
    }
    return [
      unreadable(unread),
      ...missing.filter((said) => said !== missingFont(index, unread)),
    ];
  }
}

/** The warning for a font whose files would not read. */
function unreadable(font: string): string {
  return `${font} has no file this machine could read. The book is set in the one orca carries.`;
}
