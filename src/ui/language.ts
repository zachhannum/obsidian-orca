/**
 * The language the engine hyphenates in, as the panel says it.
 *
 * The patterns come from the book's own `language`, which crosses as
 * metadata rather than as CSS: the engine reads no language property.
 * A book that sets none is hyphenated as English.
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

/** The language's name in English, or nothing for a tag that names none. */
function languageName(language: string): string | undefined {
  try {
    const named = new Intl.DisplayNames(["en"], {
      type: "language",
      fallback: "none",
    }).of(language);
    return named === language ? undefined : named;
  } catch {
    // A tag the platform cannot parse is shown as the author wrote it.
    return undefined;
  }
}
