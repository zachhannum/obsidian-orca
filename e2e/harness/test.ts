/**
 * The fixtures a spec declares. One Obsidian is shared by the whole
 * run, so a spec is handed page objects over the app the harness
 * launched rather than a browser of its own.
 */

import { chromium, test as base } from "@playwright/test";
import { Book } from "./book";
import { CDP, FIXTURE } from "./launch";
import { Manuscript } from "./manuscript";
import { Navigator } from "./navigator";
import { Note } from "./note";
import { Obsidian } from "./obsidian";
import { Panel } from "./panel";
import { Site } from "./site";
import { Vault } from "./vault";

interface Fixtures {
  book: Book;
  /** The book note's own view. */
  note: Note;
  /** A chapter as the writer has it, and the icon that swaps it for the book. */
  manuscript: Manuscript;
  /** The navigator, which owns the structure of every book. */
  navigator: Navigator;
  /** The design panel, where a book's font is picked. */
  panel: Panel;
  /** The vault a spec changes, put back when the spec ends. */
  vault: Vault;
  record: void;
}

interface Shared {
  obsidian: Obsidian;
  /**
   * The sample vault, in the site's colors, for the pictures on the
   * site. One window serves the whole run: opening it typesets a book
   * of forty-six chapters.
   */
  site: Site;
}

export const test = base.extend<Fixtures, Shared>({
  obsidian: [
    async ({}, use, worker) => {
      const endpoint = process.env[CDP];
      if (endpoint === undefined) throw new Error(`${CDP} is not set`);
      // A connection never sees a worker that started before it
      // attached, and a Playwright worker after the first starts only
      // because a spec failed. That one reloads the window, so every
      // engine it looks for starts under its own connection.
      const fresh = worker.workerIndex > 0;
      await use(await Obsidian.attach(await chromium.connectOverCDP(endpoint), fresh));
    },
    { scope: "worker" },
  ],

  book: async ({ obsidian }, use) => {
    const book = new Book(obsidian);
    await use(book);
    await book.close();
  },

  note: async ({ obsidian }, use) => {
    const note = new Note(obsidian);
    await use(note);
    await note.close();
  },

  manuscript: async ({ obsidian }, use) => {
    const manuscript = new Manuscript(obsidian);
    await use(manuscript);
    await manuscript.close();
  },

  navigator: async ({ obsidian }, use) => {
    await use(new Navigator(obsidian));
  },

  panel: async ({ obsidian }, use) => {
    const panel = new Panel(obsidian);
    await use(panel);
    await panel.close();
  },

  vault: async ({ obsidian }, use) => {
    const vault = new Vault(obsidian.page, FIXTURE);
    await use(vault);
    await vault.restore();
  },

  site: [
    async ({ obsidian }, use) => {
      const site = await Site.open(obsidian);
      await use(site);
      await site.close();
    },
    { scope: "worker" },
  ],

  /**
   * Keeps a screenshot of the window and the trace a retry recorded
   * when a spec fails.
   */
  record: [
    async ({ obsidian }, use, spec) => {
      const context = obsidian.page.context();
      const retried = spec.retry > 0;
      if (retried) {
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true,
        });
      }

      await use();

      const failed = spec.status !== spec.expectedStatus;
      if (failed) {
        await spec.attach("window", {
          body: await obsidian.page.screenshot(),
          contentType: "image/png",
        });
      }
      if (retried) {
        const file = spec.outputPath("trace.zip");
        await context.tracing.stop(failed ? { path: file } : {});
        if (failed) {
          await spec.attach("trace", {
            path: file,
            contentType: "application/zip",
          });
        }
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
