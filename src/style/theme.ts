/**
 * The theme orca bundles, which is the layer under the one a design
 * generates. It sets a book in EB Garamond, the one font the engine
 * carries today, so a book whose design settles nothing still sets.
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

/** One book design orca bundles, which a book names to sit over. */
export interface Preset {
  name: string;
  css: string;
}

/** The presets the panel offers, in the order it offers them. */
export const PRESETS: readonly Preset[] = [
  { name: "Quarto", css: BUNDLED_THEME },
];

/** The named preset's CSS. A name no preset carries falls to the first. */
export function presetCss(name: string | undefined): string {
  const found = PRESETS.find((preset) => preset.name === name);
  return (found ?? PRESETS[0])?.css ?? "";
}
