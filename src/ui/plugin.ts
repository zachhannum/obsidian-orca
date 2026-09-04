import { Notice, Plugin, normalizePath } from "obsidian";
import { startEngine, type EngineHandle } from "@/engine/bootstrap";
import { EngineError } from "@/engine/errors";
import { readModule, type VaultFiles } from "@/engine/module";

/** Orca, as Obsidian loads it. */
export default class OrcaPlugin extends Plugin {
  private engine: EngineHandle | undefined;
  private unloaded = false;

  override async onload(): Promise<void> {
    try {
      const handle = await startEngine(
        await readModule(this.files(), this.directory()),
      );
      // Obsidian does not await `onload`, so an unload can land while
      // the module is still being read.
      if (this.unloaded) handle.stop();
      else this.engine = handle;
    } catch (cause) {
      new Notice(
        cause instanceof EngineError
          ? `Orca: ${cause.message}`
          : "Orca: the engine did not start",
      );
      throw cause;
    }
  }

  override onunload(): void {
    this.unloaded = true;
    this.engine?.stop();
    this.engine = undefined;
  }

  private files(): VaultFiles {
    const adapter = this.app.vault.adapter;
    return { readBinary: (path) => adapter.readBinary(normalizePath(path)) };
  }

  private directory(): string {
    const dir = this.manifest.dir;
    if (dir === undefined) {
      throw new EngineError("the plugin has no install directory");
    }
    return dir;
  }
}
