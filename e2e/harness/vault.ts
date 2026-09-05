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
    /** What a spec counts a note's writes with. */
    orcaWrites?: { at: string; count: number; ref: EventRef | undefined };
  }
}

export class Vault {
  private readonly touched = new Set<string>();

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

  async write(file: string, text: string): Promise<void> {
    this.touched.add(file);
    await this.page.evaluate(
      async ({ at, text: body }) => window.app.vault.adapter.write(at, body),
      { at: file, text },
    );
  }

  /**
   * A write on a note that is already in the vault, through the vault
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
   * How many times a note was written while `during` ran, counted by
   * the vault's own events rather than by watching the file.
   */
  async writes(file: string, during: () => Promise<void>): Promise<number> {
    this.touched.add(file);
    await this.page.evaluate((at) => {
      const held = { at, count: 0, ref: undefined as EventRef | undefined };
      held.ref = window.app.vault.on("modify", (touched) => {
        if (touched.path === at) held.count += 1;
      });
      window.orcaWrites = held;
    }, file);

    await during();

    return this.page.evaluate(() => {
      const held = window.orcaWrites;
      if (held === undefined) return 0;
      if (held.ref !== undefined) window.app.vault.offref(held.ref);
      window.orcaWrites = undefined;
      return held.count;
    });
  }

  async remove(file: string): Promise<void> {
    this.touched.add(file);
    await this.page.evaluate(
      async (at) => window.app.vault.adapter.remove(at),
      file,
    );
  }

  /** Puts back every file the spec touched. */
  async restore(): Promise<void> {
    for (const file of this.touched) {
      const text = await readFile(path.join(this.fixture, file), "utf8").catch(
        () => undefined,
      );
      await this.page.evaluate(
        async ({ at, text }) => {
          const { adapter } = window.app.vault;
          if (text === undefined) {
            if (await adapter.exists(at)) await adapter.remove(at);
          } else {
            await adapter.write(at, text);
          }
        },
        { at: file, text },
      );
    }
    this.touched.clear();
  }
}
