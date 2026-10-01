import type { BookMetadata } from "@/book/note";

const UNTITLED = "Untitled";

// Characters macOS, Windows or Linux refuse in a file name, and the
// control characters.
const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/gu;

/**
 * The name an exported book's files share, before each format's
 * extension. It is never empty and carries no character a file name on
 * macOS, Windows or Linux refuses.
 */
export function exportName(metadata: BookMetadata): string {
  const base = (metadata.title ?? "")
    .replace(/\s+/g, " ")
    .replace(FORBIDDEN, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return base === "" ? UNTITLED : base;
}

/** The vault path an export's files start from by default: beside the book note, under its export name. */
export function exportPath(book: string, metadata: BookMetadata): string {
  const name = exportName(metadata);
  const slash = book.lastIndexOf("/");
  return slash < 0 ? name : `${book.slice(0, slash)}/${name}`;
}

