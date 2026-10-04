/**
 * The system share sheet, reached through the web view's own
 * `navigator.share`. Obsidian has no share call of its own.
 */

/** A file as the share sheet takes it. */
export interface Shareable {
  /** The name the receiving app sees. */
  name: string;
  /** The file's media type. */
  type: string;
  bytes: Uint8Array;
}

/**
 * The end of a share. A share the author cancels is no error. A web
 * view refuses a share that does not start from a tap, and a tap is
 * spent once the work after it runs long, so `refused` asks for a
 * second tap.
 */
export type Shared = "shared" | "cancelled" | "refused";

export interface Sharer {
  /** True when the device shares a file of this media type. */
  takes(type: string): boolean;
  /**
   * Hands the files to the share sheet. It asks the web view before it
   * waits on anything, so a call made in a tap is inside that tap.
   */
  share(files: readonly Shareable[]): Promise<Shared>;
}

/** The part of `navigator` a share asks. */
interface Host {
  share?: unknown;
  canShare?: unknown;
}

/**
 * The share calls of the window's `navigator`. Undefined on a device
 * with no way to share a file.
 */
export function sharer(host: unknown): Sharer | undefined {
  if (typeof host !== "object" || host === null) return undefined;
  const { share, canShare } = host as Host;
  if (typeof share !== "function" || typeof canShare !== "function") return undefined;
  const file = ({ name, type, bytes }: Shareable): File =>
    new File([bytes.slice().buffer], name, { type });
  return {
    takes(type) {
      try {
        const asked: ShareData = { files: [file({ name: "file", type, bytes: new Uint8Array() })] };
        return canShare.call(host, asked) === true;
      } catch {
        return false;
      }
    },
    async share(files) {
      try {
        await share.call(host, { files: files.map(file) });
        return "shared";
      } catch (cause) {
        const name = named(cause);
        if (name === "AbortError") return "cancelled";
        if (name === "NotAllowedError") return "refused";
        throw cause;
      }
    },
  };
}

function named(cause: unknown): unknown {
  return typeof cause === "object" && cause !== null
    ? (cause as { name?: unknown }).name
    : undefined;
}
