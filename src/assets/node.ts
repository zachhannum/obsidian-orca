/**
 * The parts of Node's file system, path and OS modules that orca uses,
 * typed here rather than by `@types/node`. The plugin review types the
 * source without the package's dev dependencies, so a Node module is
 * `any` to it and each use of one is a finding.
 */

export interface Entry {
  name: string;
  isDirectory(): boolean;
}

export interface FileHandle {
  read(
    into: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface Files {
  mkdir(at: string, options: { recursive: true }): Promise<unknown>;
  open(at: string, flags: "r"): Promise<FileHandle>;
  readFile(at: string): Promise<Uint8Array<ArrayBuffer>>;
  readFile(at: string, encoding: "utf8"): Promise<string>;
  readdir(at: string, options: { withFileTypes: true }): Promise<Entry[]>;
  stat(at: string): Promise<unknown>;
  writeFile(at: string, bytes: Uint8Array): Promise<void>;
}

export interface Paths {
  sep: string;
  dirname(at: string): string;
  isAbsolute(at: string): boolean;
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  resolve(...parts: string[]): string;
}

export interface Machine {
  homedir(): string;
  platform(): string;
}

/** Node's modules, where the app has them. */
export interface Node {
  files: Files;
  paths: Paths;
  machine: Machine;
}
