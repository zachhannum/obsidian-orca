// @ts-check

// The artboards set code in two colors: the key in glacier, the rest in the
// reading color. Shiki takes a TextMate theme, so this is the whole of it.
/** @type {(name: 'dark' | 'light', key: string, text: string) => any} */
const codeTheme = (name, key, text) => ({
  name,
  type: name,
  colors: {},
  settings: [
    { settings: { foreground: text } },
    {
      scope: ['entity.name.tag', 'support.type.property-name', 'variable.other.key'],
      settings: { foreground: key },
    },
  ],
});

/** The themes a fenced block and a block a page imports are both set in. */
export const codeThemes = {
  dark: codeTheme('dark', '#6366f1', '#e9ece8'),
  light: codeTheme('light', '#3730a3', '#0a0c0f'),
};
