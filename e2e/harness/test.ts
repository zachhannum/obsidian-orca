/**
 * The fixtures a spec declares. One Obsidian is shared by the whole
 * run, so a spec is handed page objects over the app the harness
 * launched rather than a browser of its own.
 */

import { chromium, test as base } from "@playwright/test";
import { Book } from "./book";
import { CDP, FIXTURE } from "./launch";
import { Obsidian } from "./obsidian";
import { Vault } from "./vault";

interface Fixtures {
  book: Book;
  /** The vault a spec changes, put back when the spec ends. */
  vault: Vault;
  record: void;
}

interface Shared {
  obsidian: Obsidian;
}

export const test = base.extend<Fixtures, Shared>({
  obsidian: [
    async ({}, use) => {
      const endpoint = process.env[CDP];
      if (endpoint === undefined) throw new Error(`${CDP} is not set`);
      await use(await Obsidian.attach(await chromium.connectOverCDP(endpoint)));
    },
    { scope: "worker" },
  ],

  book: async ({ obsidian }, use) => {
    const book = new Book(obsidian);
    await use(book);
    await book.close();
  },

  vault: async ({ obsidian }, use) => {
    const vault = new Vault(obsidian.page, FIXTURE);
    await use(vault);
    await vault.restore();
  },

  /**
   * What a failure leaves behind: a picture of the window, and the
   * trace a retry recorded.
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
