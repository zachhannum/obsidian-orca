import { EngineError } from "@/engine/errors";

const MODULE_FILE = "fleuron_bg.wasm";

/** The vault, narrowed to what the engine reads from it. */
export interface VaultFiles {
  readBinary(path: string): Promise<ArrayBuffer>;
}

export async function readModule(
  files: VaultFiles,
  directory: string,
): Promise<ArrayBuffer> {
  const path = `${directory}/${MODULE_FILE}`;
  try {
    return await files.readBinary(path);
  } catch (cause) {
    throw new EngineError(`the engine module is not at ${path}`, { cause });
  }
}
