import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Family, FontIndex } from "@/assets/fonts";
import type { Face } from "@/book/plan";
import type { Design, PageUnit, Written } from "@/style/design";
import type { Typeset } from "@/ui/composer";
import { withKey } from "@/ui/groups";
import { missingFont } from "@/ui/picker";
import { mountPanel, type Mounted, type Shown } from "@/ui/panels";

/** The type the design panel is registered under. */
export const PANEL_VIEW = "orca-design";

/** The book the panel designs and the fonts the machine has. */
export interface Designing {
  /** The book the panel designs, which is the one being read. */
  book(): Promise<Typeset | undefined>;
  /** Writes the design into the book's own frontmatter, where it lives. */
  setDesign(book: string, design: Design): Promise<void>;
  /** The fonts the machine has. The scan runs once for the session. */
  index(): Promise<FontIndex>;
  /** One font's styles, as the bytes that cross and the keys they go under. */
  styles(font: Family): Promise<Face[]>;
  /** The unit the author measures pages in, from orca's settings. */
  unit(): PageUnit;
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
    });
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
    return Promise.resolve();
  }

  /**
   * Sends the font's styles and sets the book in it. The registry keys
   * them by content, so picking the font again sends the sheet alone.
   *
   * A file that has gone since the scan still names its font in the
   * design. The engine sets the book in the one it carries, and the
   * panel warns that the font asked for is missing.
   */
  private async pick(font: Family, key: string): Promise<void> {
    const typeset = await this.designing.book();
    if (typeset === undefined) return;
    let faces: Face[] = [];
    try {
      faces = await this.designing.styles(font);
      this.unread = undefined;
    } catch {
      this.unread = font.name;
    }
    await this.settle(typeset, key, font.name, faces);
  }

  /** Sets the book under the design with one key changed, and writes that design. */
  private async set(key: string, value: Written | undefined): Promise<void> {
    const typeset = await this.designing.book();
    if (typeset === undefined) return;
    await this.settle(typeset, key, value, []);
  }

  /**
   * Sets the book under the design with one key changed, and writes
   * that design into the note. It edits the design the engine holds, so
   * two edits in a row keep the first.
   *
   * The engine gets the sheets before orca writes the note, so the
   * pages do not wait for the save.
   */
  private async settle(
    typeset: Typeset,
    key: string,
    value: Written | undefined,
    faces: readonly Face[],
  ): Promise<void> {
    const design = withKey(typeset.design, key, value);
    typeset.restyle(design, faces);
    await this.repaint();
    await this.designing.setDesign(typeset.path, design);
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
    mounted.paint(this.shownFor(typeset, index));
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
    mounted.paint(this.shownFor(typeset, await this.designing.index()));
  }

  /** The panel's state for one book, from the engine and the index. */
  private shownFor(typeset: Typeset, index: FontIndex): Shown {
    const font = typeset.font;
    return {
      kind: "book",
      name: typeset.name,
      design: typeset.design,
      index,
      unit: this.designing.unit(),
      language: typeset.language,
      missing: this.warning(index, font),
    };
  }

  /** The warning for the font a design asked for, if there is one. */
  private warning(index: FontIndex, font: string | undefined): string | undefined {
    return font !== undefined && font === this.unread
      ? unreadable(font)
      : missingFont(index, font);
  }
}

/** The warning for a font whose files would not read. */
function unreadable(font: string): string {
  return `${font} has no file this machine could read. The book is set in the one orca carries.`;
}
