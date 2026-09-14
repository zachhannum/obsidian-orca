/**
 * The desktop adapter: the OS save dialog, and the sink that writes an
 * export to the vault or to a real path on disk.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Destination, Sink } from "@/assets/destination";
import { vaultWritePath } from "@/assets/destination";
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

/** A vault path goes through the vault's adapter, and a disk path is written where the dialog chose. */
export function desktopSink(vault: VaultAdapter): Sink {
  return {
    async write(destination: Destination, bytes: Uint8Array): Promise<void> {
      if (destination.kind === "vault") {
        await vault.writeBinary(vaultWritePath(destination.path), bytes);
        return;
      }
      await mkdir(path.dirname(destination.path), { recursive: true });
      await writeFile(destination.path, bytes);
    },
  };
}
