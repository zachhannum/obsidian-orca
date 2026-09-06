/**
 * The one theme orca bundles, until the design panel can generate a
 * stylesheet of its own. It sets a book in EB Garamond, the one face
 * the engine carries today, at the size the reading order sets in and
 * the size its headings open on.
 */

/** The sheet orca sends its own styling under, which a warning names. */
export const THEME_SHEET = "orca.css";

/** The bundled theme's CSS, sent as one `style` op. */
export const BUNDLED_THEME = `
book {
  font-family: "EB Garamond", serif;
  font-size: 11pt;
  line-height: 1.5;
  text-align: justify;
  hyphens: auto;
}

:is(h1, h2, h3, h4, h5, h6) {
  font-size: 19pt;
  font-weight: 400;
}
`;
