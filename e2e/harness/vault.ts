/**
 * The vault a spec is allowed to change. Every write goes through here
 * and is put back from the checked-in fixture when the spec ends, so
 * the next spec opens on the vault as it is checked in.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

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

  async write(file: string, text: string): Promise<void> {
    this.touched.add(file);
    await this.page.evaluate(
      async ({ at, text: body }) => window.app.vault.adapter.write(at, body),
      { at: file, text },
    );
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
      const held = await readFile(path.join(this.fixture, file), "utf8").catch(
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
        { at: file, text: held },
      );
    }
    this.touched.clear();
  }
}
