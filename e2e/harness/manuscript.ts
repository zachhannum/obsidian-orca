/**
 * A chapter as the writer has it: the editor pane, the icon that swaps
 * it for the book, and the caret a toggle back has to bring with it.
 */

import { expect, type Locator } from "@playwright/test";
import type { MarkdownView } from "obsidian";
import { MARKDOWN, OPEN_PREVIEW } from "./note";
import { SCROLLER, type Obsidian } from "./obsidian";

/** The caret in a manuscript, as the editor keeps it. */
export interface Caret {
  line: number;
  ch: number;
}

export class Manuscript {
  /** Every pane showing a note as markdown. */
  readonly pane: Locator;
  /** The icon in a note's header that swaps the pane for the book. */
  readonly asBook: Locator;
  /** The note as the reader has it. A pane holds the markup of both views. */
  readonly reader: Locator;
  /** Every chip orca draws over one of fleuron's attribute runs. */
  readonly runs: Locator;
  /** Every heading orca draws over a setext underline in reading view. */
  readonly setext: Locator;
  /** Every rule orca draws over a break command. */
  readonly breaks: Locator;

  constructor(private readonly obsidian: Obsidian) {
    this.pane = this.obsidian.view(MARKDOWN);
    this.asBook = this.obsidian.action(OPEN_PREVIEW);
    this.reader = this.pane.locator(SCROLLER.preview);
    this.runs = this.pane.getByTestId("orca-run");
    this.setext = this.pane.getByTestId("orca-setext");
    this.breaks = this.pane.getByTestId("orca-break");
  }

  /**
   * Reads the note the way the writer does, or the way the reader
   * does. The mode is the note's own, so it stays until it is set
   * back.
   */
  async read(mode: "source" | "preview"): Promise<void> {
    await this.obsidian.page.evaluate(
      async ({ type, as }) => {
        const leaf = window.app.workspace.getLeavesOfType(type)[0];
        if (leaf === undefined) throw new Error("no manuscript is open");
        const state = leaf.getViewState();
        await leaf.setViewState({
          ...state,
          state: { ...state.state, mode: as, source: false },
        });
      },
      { type: MARKDOWN, as: mode },
    );
  }

  /**
   * Every chip in the pane, as `#id .class` and in the order they are
   * drawn. A run the engine read and cannot use reads as it was
   * written.
   */
  async chips(): Promise<string[]> {
    return this.runs.evaluateAll((chips) =>
      chips.map((chip) =>
        [...chip.children].map((part) => part.textContent ?? "").join(" ").trim(),
      ),
    );
  }

  /**
   * Every chip in the note, gathered by reading down it a pane at a
   * time. Both views draw only the part of a note they have on
   * screen, so the pane is scrolled through the note and the marks
   * are gathered as they are drawn.
   */
  async chipsThrough(): Promise<string[]> {
    return (await this.sweep()).chips;
  }

  /**
   * Every line of a setext heading in the note, as `level:text`, and
   * every underline as `under:text`, in the order they are written.
   */
  async setextThrough(): Promise<string[]> {
    return (await this.sweep()).setext;
  }

  /**
   * Every break in the note, as `form:name`, in the order they are
   * written.
   */
  async breaksThrough(): Promise<string[]> {
    return (await this.sweep()).breaks;
  }

  /** The marks drawn over the whole note, read a pane at a time. */
  private async sweep(): Promise<{
    chips: string[];
    setext: string[];
    breaks: string[];
  }> {
    return this.obsidian.page.evaluate(
      async ({ type, scroller }) => {
        const view = window.app.workspace.getLeavesOfType(type)[0]?.view as
          | MarkdownView
          | undefined;
        if (view === undefined) throw new Error("no note is open");
        const pane = view.containerEl.querySelector(
          view.getMode() === "preview" ? scroller.preview : scroller.source,
        );
        if (pane === null) throw new Error("the note is drawn in no pane");
        const chips: string[] = [];
        const setext: string[] = [];
        const breaks: string[] = [];
        const keep = (into: string[], said: string): void => {
          if (!into.includes(said)) into.push(said);
        };
        const gather = (): void => {
          for (const chip of pane.querySelectorAll("[data-testid='orca-run']")) {
            keep(
              chips,
              [...chip.children].map((part) => part.textContent ?? "").join(" ").trim(),
            );
          }
          // One query, so the lines come back in the order they are
          // written rather than grouped by what they are.
          for (const line of pane.querySelectorAll(
            ".cm-line.orca-setext, .cm-line.orca-setext-under",
          )) {
            const level = /orca-setext-(\d)/.exec(line.className)?.[1] ?? "under";
            keep(setext, `${level}:${(line.textContent ?? "").trim()}`);
          }
          for (const rule of pane.querySelectorAll("[data-testid='orca-break']")) {
            const form = rule.getAttribute("data-form") ?? "";
            keep(breaks, `${form}:${(rule.textContent ?? "").trim()}`);
          }
        };
        // The pane measures what it draws on the next frame, so each
        // step waits for one before it reads.
        const painted = async (): Promise<void> => {
          await new Promise((settle) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(settle);
            });
          });
        };
        const step = Math.max(pane.clientHeight / 2, 1);
        for (let at = 0; at < pane.scrollHeight + step; at += step) {
          pane.scrollTop = at;
          await painted();
          gather();
        }
        pane.scrollTop = 0;
        await painted();
        gather();
        return { chips, setext, breaks };
      },
      { type: MARKDOWN, scroller: SCROLLER },
    );
  }

  /** The line each setext heading holds, joined by a space. */
  async headings(): Promise<string[]> {
    return this.setext.evaluateAll((found) =>
      found.map((heading) => `${heading.tagName.toLowerCase()}:${(heading.textContent ?? "").trim()}`),
    );
  }

  /** Opens a note in the active pane. */
  async open(path: string): Promise<void> {
    await this.obsidian.open(path);
  }

  /**
   * Opens a note in the pane the manuscript is already in, which is
   * how a writer moves through a book with the preview beside it.
   */
  async moveTo(path: string): Promise<void> {
    await this.obsidian.page.evaluate(
      async ({ type, at }) => {
        const leaf = window.app.workspace.getLeavesOfType(type)[0];
        const file = window.app.vault.getFileByPath(at);
        if (leaf === undefined || file === null) {
          throw new Error(`no manuscript to open ${at} in`);
        }
        await leaf.openFile(file, { active: true });
      },
      { type: MARKDOWN, at: path },
    );
  }

  /** Puts the caret on a line of the note the first manuscript pane holds. */
  async place(at: Caret): Promise<void> {
    await this.obsidian.page.evaluate(
      ({ type, caret }) => {
        const view = window.app.workspace.getLeavesOfType(type)[0]?.view as
          | MarkdownView
          | undefined;
        if (view?.editor === undefined) throw new Error("no manuscript is open");
        view.editor.setCursor(caret);
      },
      { type: MARKDOWN, caret: at },
    );
  }

  /**
   * The line the first manuscript pane is scrolled to, counting from 0.
   * The scroll is a fraction of a line, and the line it names is the
   * first one whole on screen.
   */
  async scroll(): Promise<number> {
    return this.obsidian.page.evaluate((type) => {
      const view = window.app.workspace.getLeavesOfType(type)[0]?.view as
        | MarkdownView
        | undefined;
      if (view === undefined) throw new Error("no manuscript is open");
      return Math.round(view.currentMode.getScroll());
    }, MARKDOWN);
  }

  /**
   * Scrolls that pane so `line` is at its top, the way a reader reads,
   * and answers with the line it landed on. A pane Obsidian has just
   * rebuilt has no height to scroll until it has been laid out, so the
   * scroll is applied until the pane reports that line at its top. The
   * last lines of a note cannot be brought there, so they are not
   * lines to ask for.
   */
  async scrollTo(line: number): Promise<number> {
    let at = 0;
    await expect
      .poll(async () => {
        await this.applyScroll(line);
        at = await this.scroll();
        return at;
      })
      .toBe(line);
    return at;
  }

  private async applyScroll(line: number): Promise<void> {
    await this.obsidian.page.evaluate(
      ({ type, at }) => {
        const view = window.app.workspace.getLeavesOfType(type)[0]?.view as
          | MarkdownView
          | undefined;
        if (view === undefined) throw new Error("no manuscript is open");
        view.currentMode.applyScroll(at);
      },
      { type: MARKDOWN, at: line },
    );
  }

  /**
   * Types at the caret, one keystroke at a time, the way a writer does.
   * The caret is where {@link Manuscript.place} left it.
   */
  async type(text: string): Promise<void> {
    await this.obsidian.page.evaluate((type) => {
      const view = window.app.workspace.getLeavesOfType(type)[0]?.view as
        | MarkdownView
        | undefined;
      if (view?.editor === undefined) throw new Error("no manuscript is open");
      view.editor.focus();
    }, MARKDOWN);
    await this.obsidian.page.keyboard.type(text);
  }

  /** The caret in the first manuscript pane, or nothing when none is open. */
  async caret(): Promise<Caret | undefined> {
    return this.obsidian.page.evaluate((type) => {
      const view = window.app.workspace.getLeavesOfType(type)[0]?.view as
        | MarkdownView
        | undefined;
      if (view?.editor === undefined) return undefined;
      const { line, ch } = view.editor.getCursor();
      return { line, ch };
    }, MARKDOWN);
  }

  /** The note each manuscript pane is showing, in the order the workspace has them. */
  async showing(): Promise<string[]> {
    return this.obsidian.page.evaluate(
      (type) =>
        window.app.workspace
          .getLeavesOfType(type)
          .map((leaf) => (leaf.view as MarkdownView).file?.path ?? ""),
      MARKDOWN,
    );
  }

  async close(): Promise<void> {
    await this.obsidian.detach(MARKDOWN);
  }
}
