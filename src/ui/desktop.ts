/**
 * The desktop adapter: the OS save dialog, and the sink that writes an
 * export to the vault or to a real path on disk.
 */

import { Platform } from "obsidian";
import type { Destination, Sink } from "@/assets/destination";
import { vaultWritePath } from "@/assets/destination";
import type { Files, Machine, Node, Paths } from "@/assets/node";
import type { VaultAdapter } from "@/assets/vault";

/** The part of Electron's save dialog export asks. */
interface SaveDialog {
  showSaveDialog(options: {
    title: string;
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

/** The desktop app hands a plugin Node's own `require` on the window. */
interface Desktop {
  require?: (id: string) => unknown;
}

/**
 * True where Node and Electron are there to load. Mobile emulation
 * leaves the desktop app's Node in place and clears `isDesktop`, so
 * both are read and an emulated run takes the mobile paths.
 */
export function onDesktop(): boolean {
  return Platform.isDesktopApp && Platform.isDesktop;
}

/**
 * Node's modules, loaded on the first call rather than with the plugin.
 * The renderer resolves no `node:` module through `import()`, so they
 * come through the app's `require`.
 */
export async function node(): Promise<Node> {
  if (!Platform.isDesktop) throw new Error("Node is only on the desktop app");
  const load = (window as unknown as Desktop).require;
  if (load === undefined) throw new Error("the app gives the plugin no Node");
  return Promise.resolve({
    files: load("node:fs/promises") as Files,
    paths: load("node:path") as Paths,
    machine: load("node:os") as Machine,
  });
}

/** The save dialog, or undefined when the app gives the plugin no Electron. */
function saveDialog(): SaveDialog | undefined {
  const electron = (window as unknown as Desktop).require?.("electron") as
    | { remote?: { dialog?: SaveDialog } }
    | undefined;
  return electron?.remote?.dialog;
}

/**
 * Asks the OS where to write. Resolves undefined when the author cancels
 * or the app has no dialog to show.
 */
export async function chooseDiskPath(
  name: string,
  format: { label: string; extension: string },
): Promise<string | undefined> {
  const dialog = saveDialog();
  if (dialog === undefined) return undefined;
  const chosen = await dialog.showSaveDialog({
    title: `Export to ${format.label}`,
    defaultPath: name,
    filters: [{ name: format.label, extensions: [format.extension] }],
  });
  return chosen.canceled ? undefined : chosen.filePath;
}

/**
 * A vault path goes through the vault's adapter, and a disk path is
 * written where the dialog chose. Only the desktop app offers a disk
 * path, so only it loads Node.
 */
export function desktopSink(vault: VaultAdapter): Sink {
  return {
    async write(destination: Destination, bytes: Uint8Array): Promise<void> {
      if (destination.kind === "vault") {
        await vault.writeBinary(vaultWritePath(destination.path), bytes);
        return;
      }
      const { files, paths } = await node();
      await files.mkdir(paths.dirname(destination.path), { recursive: true });
      await files.writeFile(destination.path, bytes);
    },
  };
}
