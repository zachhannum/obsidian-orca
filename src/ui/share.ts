/**
 * The system share sheet, reached through the web view's own
 * `navigator.share`. Obsidian has no share call of its own.
 */

/** A file as the share sheet takes it. */
export interface Shareable {
  /** The name the receiving app sees. */
  name: string;
  bytes: ArrayBuffer;
}

/** The end of a share. A share the author cancels is no error. */
export type Shared = "shared" | "cancelled";

/**
 * Hands a file to the share sheet. It asks the web view before it
 * waits on anything, because a share only starts from a tap.
 */
export type Sharer = (file: Shareable) => Promise<Shared>;

/** The part of `navigator` a share asks. */
interface Host {
  share?: unknown;
  canShare?: unknown;
}

/**
 * The share call for files of one media type, read off the window's
 * `navigator`. Undefined on a device that cannot share such a file.
 */
export function sharer(host: unknown, type: string): Sharer | undefined {
  if (typeof host !== "object" || host === null) return undefined;
  const { share, canShare } = host as Host;
  if (typeof share !== "function" || typeof canShare !== "function") return undefined;
  const asked = (data: ShareData): unknown => canShare.call(host, data);
  try {
    if (asked({ files: [new File([], "file", { type })] }) !== true) return undefined;
  } catch {
    return undefined;
  }
  return async ({ name, bytes }) => {
    try {
      await share.call(host, { files: [new File([bytes], name, { type })] });
      return "shared";
    } catch (cause) {
      if (cancelled(cause)) return "cancelled";
      throw cause;
    }
  };
}

/** True for the rejection a web view gives when the author shuts the share sheet. */
function cancelled(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}
