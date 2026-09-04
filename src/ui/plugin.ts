import { Notice, Plugin, normalizePath, type WorkspaceLeaf } from "obsidian";
import { startEngine, type EngineHandle } from "@/engine/bootstrap";
import { EngineError } from "@/engine/errors";
import { readModule, type VaultFiles } from "@/engine/module";
import { Session, documentFaces } from "@/engine/session";
import { PREVIEW_VIEW, PreviewView } from "@/ui/preview";

/** Orca, as Obsidian loads it. */
export default class OrcaPlugin extends Plugin {
  private engine: EngineHandle | undefined;
  private unloaded = false;

  override async onload(): Promise<void> {
    // The session is opened before anything is registered, so the views
    // Obsidian restores at startup all wait on the one engine.
    const opening = this.open();

    this.registerView(PREVIEW_VIEW, (leaf) => new PreviewView(leaf, opening));
    this.addRibbonIcon("book", "Open the book", () => {
      void this.reveal();
    });
    this.addCommand({
      id: "open-book",
      name: "Open the book",
      callback: () => {
        void this.reveal();
      },
    });

    await opening;
  }

  override onunload(): void {
    this.unloaded = true;
    this.engine?.stop();
    this.engine = undefined;
  }

  private async open(): Promise<Session> {
    try {
      const handle = await startEngine(
        await readModule(this.files(), this.directory()),
      );
      // Obsidian does not await `onload`, so an unload can land while
      // the module is still being read.
      if (this.unloaded) handle.stop();
      else this.engine = handle;
      return new Session(handle.client, documentFaces(document));
    } catch (cause) {
      new Notice(
        cause instanceof EngineError
          ? `Orca: ${cause.message}`
          : "Orca: the engine did not start",
      );
      throw cause;
    }
  }

  /** Brings the preview up, reusing the leaf already on it. */
  private async reveal(): Promise<void> {
    const { workspace } = this.app;
    const open: WorkspaceLeaf | undefined =
      workspace.getLeavesOfType(PREVIEW_VIEW)[0];
    const leaf = open ?? workspace.getLeaf(true);
    if (open === undefined) {
      await leaf.setViewState({ type: PREVIEW_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
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
