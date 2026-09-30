import type { BookMetadata } from "@/book/note";

const UNTITLED = "Untitled";

// Characters macOS, Windows or Linux refuse in a file name, and the
// control characters.
const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/gu;

/**
 * The file name for an exported book. The name before the extension is
 * never empty and carries no character a file name on macOS, Windows or
 * Linux refuses.
 */
export function exportName(metadata: BookMetadata, extension: string): string {
  const base = (metadata.title ?? "")
    .replace(/\s+/g, " ")
    .replace(FORBIDDEN, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return `${base === "" ? UNTITLED : base}.${extension}`;
}

/** The vault path an export is written to by default: beside the book note, under its export name. */
export function exportPath(
  book: string,
  metadata: BookMetadata,
  extension: string,
): string {
  const name = exportName(metadata, extension);
  const slash = book.lastIndexOf("/");
  return slash < 0 ? name : `${book.slice(0, slash)}/${name}`;
}

/** A path or name with its format's extension, in place of any `known` one it ended in. */
export function withExtension(path: string, known: readonly string[], extension: string): string {
  const lower = path.toLowerCase();
  const old = known.find((each) => lower.endsWith(`.${each}`));
  const stem = old === undefined ? path : path.slice(0, -(old.length + 1));
  return `${stem}.${extension}`;
}
