/**
 * The vault a spec is allowed to change. Every write goes through here
 * and is put back from the checked-in fixture when the spec ends, so
 * the next spec opens on the vault as it is checked in.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { EventRef } from "obsidian";
import { PLUGIN } from "./launch";

declare global {
  interface Window {
    /** The write counter a spec installs while `writes` runs. */
    orcaWrites?: { at: string; count: number; ref: EventRef | undefined };
  }
}

/** The part of the plugin the restore asks what the engine has taken in. */
interface Absorbing {
  /** The book each note belongs to, by the note's vault path. */
  members?: Map<string, { book: string }>;
  composer?: {
    /** The book at each path, set or still setting. */
    books?: Map<string, Taking>;
  };
}

/** One book on the engine, with the run that set it tagged once it lands. */
type Taking = Promise<Took> & {
  /** The book once its run ended: the typeset, or null for a run that failed. */
  orcaTook?: Took | null | undefined;
};

/** One book the engine holds, as much of it as the restore reads. */
interface Took {
  /** True when no edit is waiting and no render is in flight. */
  quiet: boolean;
  /** The text a note last crossed as, which the restore makes match the fixture. */
  textOf(note: string): string | undefined;
}

/** The state the restore waits out, which is every other answer than this one. */
const QUIET = "quiet";

export class Vault {
  private readonly touched = new Set<string>();
  private readonly folders = new Set<string>();

  constructor(
    private readonly page: Page,
    private readonly fixture: string,
  ) {}

  /** The notes at the top of the vault, in the order Obsidian lists them. */
  async notes(): Promise<string[]> {
    return this.page.evaluate(
      async () => (await window.app.vault.adapter.list("/")).files,
    );
  }

  /** A note's text, as it is in the vault. */
  async read(file: string): Promise<string> {
    return this.page.evaluate(
      async (at) => window.app.vault.adapter.read(at),
      file,
    );
  }

  /** A file's bytes, as they are in the vault. */
  async bytes(file: string): Promise<Buffer> {
    const encoded = await this.page.evaluate(async (at) => {
      const bytes = new Uint8Array(await window.app.vault.adapter.readBinary(at));
      let said = "";
      for (let from = 0; from < bytes.length; from += 0x8000) {
        said += String.fromCharCode(...bytes.subarray(from, from + 0x8000));
      }
      return btoa(said);
    }, file);
    return Buffer.from(encoded, "base64");
  }

  async write(file: string, text: string): Promise<void> {
    this.touched.add(file);
    await this.page.evaluate(
      async ({ at, text: body }) => window.app.vault.adapter.write(at, body),
      { at: file, text },
    );
  }

  /**
   * Writes a note that is already in the vault, through the vault
   * rather than the adapter, which is how an editor or a sync client
   * writes one.
   */
  async modify(file: string, text: string): Promise<void> {
    this.touched.add(file);
    await this.page.evaluate(
      async ({ at, text: body }) => {
        const note = window.app.vault.getFileByPath(at);
        if (note === null) throw new Error(`no note at ${at}`);
        await window.app.vault.modify(note, body);
      },
      { at: file, text },
    );
  }

  /** Marks a note the app itself writes, so the spec puts it back. */
  touch(file: string): void {
    this.touched.add(file);
  }

  /**
   * Counts the writes to a note while `during` runs, from the vault's
   * own events rather than by watching the file.
   */
  async writes(file: string, during: () => Promise<void>): Promise<number> {
    this.touched.add(file);
    await this.page.evaluate((at) => {
      const writes = { at, count: 0, ref: undefined as EventRef | undefined };
      writes.ref = window.app.vault.on("modify", (touched) => {
        if (touched.path === at) writes.count += 1;
      });
      window.orcaWrites = writes;
    }, file);

    await during();

    return this.page.evaluate(() => {
      const writes = window.orcaWrites;
      if (writes === undefined) return 0;
      if (writes.ref !== undefined) window.app.vault.offref(writes.ref);
      window.orcaWrites = undefined;
      return writes.count;
    });
  }

  /** Creates a folder for the spec. It is removed with its contents when the spec ends. */
  async folder(path: string): Promise<void> {
    this.folders.add(path);
    await this.page.evaluate(async (at) => {
      if (!(await window.app.vault.adapter.exists(at))) {
        await window.app.vault.createFolder(at);
      }
    }, path);
  }

  async remove(file: string): Promise<void> {
    this.touched.add(file);
    await this.page.evaluate(
      async (at) => window.app.vault.adapter.remove(at),
      file,
    );
  }

  /**
   * Puts back every file the spec touched, and returns once Obsidian
   * has indexed each one and the engine has taken it in. A write the
   * vault sees late is a change the next spec gets: the book note
   * parses as no book for a moment, and a chapter crosses to the engine
   * as an edit. The edit is coalesced, so the render it costs lands one
   * wait after the write, inside the next spec unless it is waited out
   * here.
   *
   * Obsidian writes a note it has open some time after the keystrokes
   * that made it, and that write can land after the put-back. The
   * put-back and the wait therefore run together until the vault and
   * the engine both hold the fixture.
   */
  async restore(): Promise<void> {
    const want = new Map<string, string | undefined>();
    for (const file of this.touched) {
      want.set(
        file,
        await readFile(path.join(this.fixture, file), "utf8").catch(() => undefined),
      );
    }
    if (want.size > 0) {
      await expect
        .poll(async () => {
          for (const [file, text] of want) await this.putBack(file, text);
          return this.absorbed(want);
        })
        .toBe(QUIET);
    }
    for (const folder of this.folders) {
      await this.page.evaluate(async (at) => {
        const found = window.app.vault.getFolderByPath(at);
        if (found !== null) await window.app.vault.delete(found, true);
      }, folder);
    }
    this.touched.clear();
    this.folders.clear();
  }

  /**
   * Writes one file back as the fixture has it, and returns once
   * Obsidian has indexed it. A file already as the fixture has it is
   * left alone, so running this again costs a read.
   */
  private async putBack(file: string, text: string | undefined): Promise<void> {
    await this.page.evaluate(
      async ({ at, text }) => {
        const { vault, metadataCache } = window.app;
        const { adapter } = vault;
        const had = (await adapter.exists(at)) ? await adapter.read(at) : undefined;
        if (had === text) return;
        const indexed = new Promise<void>((resolve) => {
          const ref: EventRef =
            text === undefined
              ? vault.on("delete", (gone) => {
                  if (gone.path !== at) return;
                  vault.offref(ref);
                  resolve();
                })
              : metadataCache.on("changed", (note, data) => {
                  if (note.path !== at || data !== text) return;
                  metadataCache.offref(ref);
                  resolve();
                });
        });
        if (text === undefined) await adapter.remove(at);
        else await adapter.write(at, text);
        await indexed;
      },
      { at: file, text },
    );
  }

  /**
   * The state every book on the engine is in, which is {@link QUIET}
   * once each one has crossed the notes the put-back wrote and has
   * nothing waiting or rendering. Any other answer names the book or
   * the note it is still waiting on, so a wait that runs out says what
   * it was waiting for.
   *
   * A book still setting is read off a tag on its own run rather than
   * waited on here, so one book that never lands is a wait that ends
   * rather than a page call that hangs.
   */
  private async absorbed(want: Map<string, string | undefined>): Promise<string> {
    return this.page.evaluate(
      ({ id, notes, quiet }) => {
        const orca = window.app.plugins.plugins[id] as Absorbing | undefined;
        const books = orca?.composer?.books;
        if (books === undefined) return quiet;
        for (const [at, run] of books) {
          if (!("orcaTook" in run)) {
            run.orcaTook = undefined;
            void run.then(
              (took) => {
                run.orcaTook = took;
              },
              () => {
                run.orcaTook = null;
              },
            );
          }
          const took = run.orcaTook;
          if (took === undefined) return `setting ${at}`;
          // A run that failed set no book, so it holds nothing to wait on.
          if (took === null) continue;
          for (const [note, text] of notes) {
            if (text === undefined) continue;
            if (orca?.members?.get(note)?.book !== at) continue;
            const crossed = took.textOf(note);
            // A note this book never sent is a note it does not read.
            if (crossed === undefined || crossed === text) continue;
            return `stale ${note}`;
          }
          if (!took.quiet) return `rendering ${at}`;
        }
        return quiet;
      },
      { id: PLUGIN, notes: [...want], quiet: QUIET },
    );
  }
}
