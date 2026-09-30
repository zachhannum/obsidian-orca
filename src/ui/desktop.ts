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

interface Desktop {
  require?: (id: string) => { remote?: { dialog?: SaveDialog } } | undefined;
}

/**
 * True where Node and Electron are there to load. Mobile emulation
 * leaves the desktop app's Node in place and clears `isDesktop`, so
 * both are read and an emulated run takes the mobile paths.
 */
export function onDesktop(): boolean {
  return Platform.isDesktopApp && Platform.isDesktop;
}

let loading: Promise<Node> | undefined;

/** Node's modules, loaded on the first call rather than with the plugin. */
export async function node(): Promise<Node> {
  if (!Platform.isDesktop) throw new Error("Node is only on the desktop app");
  loading ??= Promise.all([
    import("node:fs/promises"),
    import("node:path"),
    import("node:os"),
  ]).then(([files, paths, machine]) => ({
    files: files as Files,
    paths: paths as Paths,
    machine: machine as Machine,
  }));
  return loading;
}

/** The save dialog, or undefined when the app gives the plugin no Electron. */
function saveDialog(): SaveDialog | undefined {
  const desktop = window as unknown as Desktop;
  return desktop.require?.("electron")?.remote?.dialog;
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
