/**
 * Every font and image a book needs, keyed by the hash of its bytes.
 *
 * A book set in one face on thirty-four chapters names one file
 * thirty-four times, so what has already crossed is decided by content
 * rather than by path. The registry is the main thread's record of
 * that, and an op path asks it before putting bytes on the wire.
 *
 * The engine keeps the other cache, the one that decides what a page
 * is set from. A url a page draws from is made here out of the bytes
 * that crossed under the same key, so the two cannot disagree about
 * which pixels a page was painted with.
 */

import { readBytes, type VaultAdapter } from "@/assets/vault";

/** A file the registry has read, and the key its bytes go under. */
export interface Hashed {
  /** The hash of the bytes. Two paths over the same file share it. */
  key: string;
  bytes: Uint8Array;
}

/** The record the registry keeps for one asset. */
export interface Held {
  /** Whether they have crossed to the engine. */
  sent: boolean;
  /** The face the engine registered them as. */
  fontId?: number;
  /** The url a painter draws them from. */
  objectUrl?: string;
}

/** The registry, as much of it as planning an op reads. */
export interface Sent {
  /** Whether these bytes have already crossed to the engine. */
  sent(key: string): boolean;
}

/** A session with nothing registered, for a plan compared rather than run. */
export const SENT_NOTHING: Sent = { sent: () => false };

/** Gives up a url a page was drawn from. */
export interface Revoke {
  (url: string): void;
}

/** Runs work once the thread has nothing better to do. */
export interface Later {
  (run: () => void): void;
}

/** Makes the url a page draws bytes from. */
export interface Mint {
  (bytes: Uint8Array): string;
}

export const revokeUrl: Revoke = (url) => {
  URL.revokeObjectURL(url);
};

export const blobUrl: Mint = (bytes) =>
  URL.createObjectURL(new Blob([new Uint8Array(bytes)]));

/** The browser's idle time, or the next turn of the loop without it. */
export const whenIdle: Later = (run) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => run());
  else setTimeout(run, 0);
};

/** Hashes bytes to the key they go under, as hex SHA-256. */
export async function contentKey(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The assets one session holds, on the main thread.
 * {@link Registry.close} gives back every url it was handed, so none
 * outlives the session that made it.
 */
export class Registry implements Sent {
  private readonly held = new Map<string, Held>();
  /** The key each vault path hashed to, so a file is hashed once. */
  private readonly keys = new Map<string, Promise<string>>();
  /** The key the image behind each manuscript url went under. */
  private readonly named = new Map<string, string>();

  constructor(
    private readonly vault: VaultAdapter,
    private readonly revoke: Revoke = revokeUrl,
    private readonly later: Later = whenIdle,
    private readonly mint: Mint = blobUrl,
  ) {}

  /** The key the file at this vault path goes under. */
  key(path: string): Promise<string> {
    const known = this.keys.get(path);
    if (known !== undefined) return known;
    return this.keeping(path, this.hash(path));
  }

  /** The file at this vault path, and the key its bytes go under. */
  async take(path: string): Promise<Hashed> {
    const bytes = new Uint8Array(await readBytes(this.vault, path));
    const known = this.keys.get(path);
    if (known !== undefined) return { key: await known, bytes };
    return { key: await this.keeping(path, contentKey(bytes)), bytes };
  }

  /**
   * Hashes these paths once the thread is free, so the pick that sends
   * a file waits on nothing a first paint could have paid for.
   */
  prime(paths: readonly string[]): void {
    for (const path of paths) {
      if (this.keys.has(path)) continue;
      this.later(() => {
        // A file that will not read is read again by whatever asks for
        // it, so nothing here is worth reporting.
        void this.key(path).catch(() => undefined);
      });
    }
  }

  sent(key: string): boolean {
    return this.held.get(key)?.sent === true;
  }

  /** Records that these bytes have crossed, and the face they registered as. */
  crossed(key: string, fontId?: number): void {
    const held = this.entry(key);
    held.sent = true;
    if (fontId !== undefined) held.fontId = fontId;
  }

  /** The face the engine registered these bytes as. */
  fontId(key: string): number | undefined {
    return this.held.get(key)?.fontId;
  }

  /** The url a painter draws these bytes from. */
  url(key: string): string | undefined {
    return this.held.get(key)?.objectUrl;
  }

  /** Keeps the url a page draws these bytes from, giving back the one it replaces. */
  hold(key: string, objectUrl: string): void {
    const held = this.entry(key);
    const was = held.objectUrl;
    held.objectUrl = objectUrl;
    if (was !== undefined && was !== objectUrl) this.revoke(was);
  }

  /**
   * Keeps one image the manuscript names: the key its bytes went under,
   * and the url a page draws them from. The engine is sent the same
   * bytes under the same manuscript url, so a page and the layout it
   * was set from cannot disagree about what an embed is.
   *
   * Two urls over one file share a key and therefore one url to draw
   * from, the same way two chapters in one face share a crossing.
   */
  image(named: string, image: Hashed): void {
    this.named.set(named, image.key);
    if (this.url(image.key) === undefined) {
      this.hold(image.key, this.mint(image.bytes));
    }
  }

  /**
   * The url a page draws the image a manuscript url names from.
   * Nothing for an embed that never resolved.
   */
  imageUrl(named: string): string | undefined {
    const key = this.named.get(named);
    return key === undefined ? undefined : this.url(key);
  }

  /** Drops one asset, giving back the url it held. */
  evict(key: string): void {
    const held = this.held.get(key);
    if (held === undefined) return;
    this.held.delete(key);
    if (held.objectUrl !== undefined) this.revoke(held.objectUrl);
  }

  /** Drops every asset. No url outlives the session that made it. */
  close(): void {
    for (const key of [...this.held.keys()]) this.evict(key);
    this.keys.clear();
    this.named.clear();
  }

  private async hash(path: string): Promise<string> {
    return contentKey(new Uint8Array(await readBytes(this.vault, path)));
  }

  private entry(key: string): Held {
    const held = this.held.get(key) ?? { sent: false };
    this.held.set(key, held);
    return held;
  }

  /** Keeps a path's key, dropping it again when the hash fails. */
  private keeping(path: string, hashing: Promise<string>): Promise<string> {
    this.keys.set(path, hashing);
    hashing.catch(() => {
      if (this.keys.get(path) === hashing) this.keys.delete(path);
    });
    return hashing;
  }
}
