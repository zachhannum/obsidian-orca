/**
 * The vault a spec is allowed to change. Every write goes through here
 * and is put back from the checked-in fixture when the spec ends, so
 * the next spec opens on the vault as it is checked in.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { EventRef } from "obsidian";

declare global {
  interface Window {
    /** The write counter a spec installs while `writes` runs. */
    orcaWrites?: { at: string; count: number; ref: EventRef | undefined };
    /** The change recorder a spec installs while `changes` runs. */
    orcaChanges?: { seen: string[]; refs: EventRef[] };
  }
}

export class Vault {
  private readonly touched = new Set<string>();
  private readonly folders = new Set<string>();
  /** The folders moved aside, each by the path it came from. */
  private readonly aside = new Map<string, string>();

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

  /**
   * Every change the vault reports while `during` runs, as the event
   * and the path it named.
   */
  async changes(during: () => Promise<void>): Promise<string[]> {
    await this.page.evaluate(() => {
      const seen: string[] = [];
      const refs = (["create", "modify", "delete", "rename"] as const).map((name) =>
        // The four events share a first argument, and the union of
        // their overloads has no signature that says so.
        (window.app.vault.on as (name: string, heard: (file: { path: string }) => void) => EventRef)(
          name,
          (file) => {
            seen.push(`${name} ${file.path}`);
          },
        ),
      );
      window.orcaChanges = { seen, refs };
    });

    await during();

    return this.page.evaluate(() => {
      const changes = window.orcaChanges;
      if (changes === undefined) return [];
      for (const ref of changes.refs) window.app.vault.offref(ref);
      window.orcaChanges = undefined;
      return changes.seen;
    });
  }

  /** The plugin's own data file as text, or nothing where it has saved none. */
  async data(plugin: string): Promise<string | undefined> {
    return this.page.evaluate(async (id) => {
      const { adapter, configDir } = window.app.vault;
      const at = `${configDir}/plugins/${id}/data.json`;
      return (await adapter.exists(at)) ? adapter.read(at) : undefined;
    }, plugin);
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
   * Moves a folder aside, so the vault has none at its path. The files
   * in it are not read or written, so a font comes back byte for byte.
   */
  async away(folder: string): Promise<void> {
    const to = `${folder}.aside`;
    this.aside.set(folder, to);
    await this.page.evaluate(
      async ({ from, to: at }) => window.app.vault.adapter.rename(from, at),
      { from: folder, to },
    );
  }

  /** Moves every folder that `away` moved back to its path. */
  async back(): Promise<void> {
    for (const [folder, at] of this.aside) {
      await this.page.evaluate(
        async ({ from, to }) => {
          const { adapter } = window.app.vault;
          if (await adapter.exists(from)) await adapter.rename(from, to);
        },
        { from: at, to: folder },
      );
    }
    this.aside.clear();
  }

  /**
   * Puts back every file the spec touched, and returns once Obsidian
   * has indexed each one. A write the vault sees late is a change the
   * next spec gets: the book note parses as no book for a moment, and a
   * chapter crosses to the engine as an edit.
   */
  async restore(): Promise<void> {
    await this.back();
    for (const file of this.touched) {
      const text = await readFile(path.join(this.fixture, file), "utf8").catch(
        () => undefined,
      );
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
    for (const folder of this.folders) {
      await this.page.evaluate(async (at) => {
        const found = window.app.vault.getFolderByPath(at);
        if (found !== null) await window.app.fileManager.trashFile(found);
      }, folder);
    }
    this.touched.clear();
    this.folders.clear();
  }
}
