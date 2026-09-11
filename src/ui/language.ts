/**
 * The line the design panel shows for the language the engine
 * hyphenates in.
 *
 * The engine takes its hyphenation patterns from the book's own
 * `language`. That value crosses as metadata, because the engine reads
 * no CSS language property. The engine hyphenates a book that sets no
 * language as English.
 */

/** The line the panel draws beside the hyphenation switch. */
export function hyphenating(language: string | undefined): string {
  if (language === undefined) {
    return "using English, until the book sets a language";
  }
  const named = languageName(language);
  return named === undefined
    ? `using ${language}`
    : `using ${named} (${language})`;
}

/** The language's name in English, or nothing for a tag with no English name. */
function languageName(language: string): string | undefined {
  try {
    const named = new Intl.DisplayNames(["en"], {
      type: "language",
      fallback: "none",
    }).of(language);
    return named === language ? undefined : named;
  } catch {
    // The panel shows a tag the platform cannot parse as the author wrote it.
    return undefined;
  }
}
