export interface Device {
  id: "phone" | "reader" | "tablet";
  label: string;
  /** CSS pixels. */
  width: number;
  /** CSS pixels. */
  height: number;
}

export const DEVICES: readonly Device[] = [
  { id: "phone", label: "Phone", width: 390, height: 844 },
  { id: "reader", label: "E-reader", width: 600, height: 800 },
  { id: "tablet", label: "Tablet", width: 820, height: 1180 },
];

export type ReaderFont = "publisher" | "oldStyle" | "modern" | "sans" | "humanist";
export type ReaderMargins = "narrow" | "normal" | "wide";
export type ReaderAlign = "start" | "justify";
export type ReaderTheme = "light" | "sepia" | "dark";

export interface ReaderSettings {
  font: ReaderFont;
  /** A percentage of the author's size. */
  size: number;
  /** Unset keeps the author's line height. */
  spacing: number | undefined;
  margins: ReaderMargins;
  /** Unset keeps the author's alignment. */
  align: ReaderAlign | undefined;
  theme: ReaderTheme;
}

export const READER_DEFAULTS: ReaderSettings = {
  font: "publisher",
  size: 100,
  spacing: undefined,
  margins: "normal",
  align: undefined,
  theme: "light",
};

export interface ReaderOption<Value> {
  value: Value;
  label: string;
}

export const READER_FONTS: readonly ReaderOption<ReaderFont>[] = [
  { value: "publisher", label: "Publisher" },
  { value: "oldStyle", label: "Old style" },
  { value: "modern", label: "Modern" },
  { value: "sans", label: "Sans" },
  { value: "humanist", label: "Humanist" },
];

export const READER_SIZE_MIN = 75;
export const READER_SIZE_MAX = 250;
export const READER_SIZE_STEP = 25;

export const READER_SPACINGS: readonly ReaderOption<number | undefined>[] = [
  { value: undefined, label: "Publisher" },
  { value: 1.2, label: "1.2" },
  { value: 1.5, label: "1.5" },
  { value: 1.75, label: "1.75" },
  { value: 2, label: "2" },
];

export const READER_MARGINS: readonly ReaderOption<ReaderMargins>[] = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
];

export const READER_ALIGNMENTS: readonly ReaderOption<ReaderAlign | undefined>[] = [
  { value: undefined, label: "Publisher" },
  { value: "start", label: "Start" },
  { value: "justify", label: "Justify" },
];

export const READER_THEMES: readonly ReaderOption<ReaderTheme>[] = [
  { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
];

const FONT_FAMILY = "--USER__fontFamily";
const FONT_SIZE = "--USER__fontSize";
const LINE_HEIGHT = "--USER__lineHeight";
const PAGE_GUTTER = "--RS__pageGutter";
const TEXT_ALIGN = "--USER__textAlign";
const BACKGROUND = "--USER__backgroundColor";
const TEXT = "--USER__textColor";
const LINK = "--USER__linkColor";
const VISITED = "--USER__visitedColor";

/** Every name `readerVariables` returns, in the order it returns them. */
export const READER_VARIABLES: readonly string[] = [
  FONT_FAMILY,
  FONT_SIZE,
  LINE_HEIGHT,
  PAGE_GUTTER,
  TEXT_ALIGN,
  BACKGROUND,
  TEXT,
  LINK,
  VISITED,
];

const STACKS: Record<ReaderFont, string | undefined> = {
  publisher: undefined,
  oldStyle: "var(--RS__oldStyleTf)",
  modern: "var(--RS__modernTf)",
  sans: "var(--RS__sansTf)",
  humanist: "var(--RS__humanistTf)",
};

const GUTTERS: Record<ReaderMargins, string> = {
  narrow: "16px",
  normal: "32px",
  wide: "56px",
};

interface Colours {
  background: string;
  text: string;
  link: string;
  visited: string;
}

// ReadiumCSS leaves a link out of the text colour, so a theme carries
// link colours of its own. Without them a link keeps the author's
// colour on the theme's background.
const COLOURS: Record<ReaderTheme, Colours | undefined> = {
  light: undefined,
  sepia: { background: "#faf4e8", text: "#121212", link: "#305282", visited: "#7b5281" },
  dark: { background: "#000000", text: "#FEFEFE", link: "#63caff", visited: "#0099E5" },
};

/** A name with no value is taken off the root, which gives the property back to the author's CSS. */
export function readerVariables(settings: ReaderSettings): ReadonlyMap<string, string | undefined> {
  const colours = COLOURS[settings.theme];
  return new Map([
    [FONT_FAMILY, STACKS[settings.font]],
    [FONT_SIZE, settings.size === 100 ? undefined : `${String(settings.size)}%`],
    [LINE_HEIGHT, settings.spacing === undefined ? undefined : String(settings.spacing)],
    [PAGE_GUTTER, GUTTERS[settings.margins]],
    [TEXT_ALIGN, settings.align],
    [BACKGROUND, colours?.background],
    [TEXT, colours?.text],
    [LINK, colours?.link],
    [VISITED, colours?.visited],
  ]);
}
