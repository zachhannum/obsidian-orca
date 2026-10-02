export type DeviceKind = "phone" | "tablet" | "ink";

/** A length on each side of a screen, in CSS pixels. */
export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * A device a book is read on. The screen is in CSS pixels, which is
 * the size a web view on the device lays a document out in, not the
 * panel's own resolution. An e-ink reader has no browser to quote, so
 * its screen is the panel's resolution halved.
 */
export interface Device {
  /** The name `data-device` carries. */
  id: string;
  label: string;
  /** An `ink` screen has no colour. */
  kind: DeviceKind;
  width: number;
  height: number;
  /** The radius of the screen's corners. */
  radius: number;
  /** The body around the screen. */
  bezel: Edges;
  /**
   * The camera's place. An `island` and a `hole` sit over the top of
   * the screen, and a `bezel` camera sits in the body above it.
   */
  camera: "island" | "hole" | "bezel" | "none";
  /**
   * The top and bottom of the screen the system keeps for itself: the
   * camera and the clock at the top, and the bar that goes home at the
   * bottom. A reading app sets no text there.
   */
  safe: { top: number; bottom: number };
}

const even = (bezel: number): Edges => ({ top: bezel, right: bezel, bottom: bezel, left: bezel });
const chin = (top: number, side: number, bottom: number): Edges => ({
  top,
  right: side,
  bottom,
  left: side,
});
const NONE = { top: 0, bottom: 0 };

export const DEVICES: readonly Device[] = [
  {
    id: "iphone",
    label: "iPhone",
    kind: "phone",
    width: 393,
    height: 852,
    radius: 47,
    bezel: even(12),
    camera: "island",
    safe: { top: 59, bottom: 34 },
  },
  {
    id: "android-phone",
    label: "Android phone",
    kind: "phone",
    width: 412,
    height: 915,
    radius: 30,
    bezel: even(10),
    camera: "hole",
    safe: { top: 40, bottom: 24 },
  },
  {
    id: "ipad",
    label: "iPad",
    kind: "tablet",
    width: 820,
    height: 1180,
    radius: 18,
    bezel: even(30),
    camera: "bezel",
    safe: NONE,
  },
  {
    id: "android-tablet",
    label: "Android tablet",
    kind: "tablet",
    width: 800,
    height: 1280,
    radius: 12,
    bezel: even(28),
    camera: "bezel",
    safe: NONE,
  },
  {
    id: "kindle-fire",
    label: "Kindle Fire",
    kind: "tablet",
    width: 601,
    height: 962,
    radius: 4,
    bezel: even(40),
    camera: "bezel",
    safe: NONE,
  },
  {
    id: "kindle-paperwhite",
    label: "Kindle Paperwhite",
    kind: "ink",
    width: 632,
    height: 840,
    radius: 0,
    bezel: chin(44, 40, 80),
    camera: "none",
    safe: NONE,
  },
  {
    id: "kobo-clara",
    label: "Kobo Clara",
    kind: "ink",
    width: 536,
    height: 724,
    radius: 0,
    bezel: chin(48, 44, 84),
    camera: "none",
    safe: NONE,
  },
  {
    id: "nook-glowlight",
    label: "Nook GlowLight",
    kind: "ink",
    width: 536,
    height: 724,
    radius: 0,
    bezel: chin(56, 60, 92),
    camera: "none",
    safe: NONE,
  },
];

/** The device a pane opens on. */
export const DEVICE_DEFAULT = "kindle-paperwhite";

/** The kinds, in the order the device list groups them. */
export const DEVICE_GROUPS: readonly { kind: DeviceKind; label: string }[] = [
  { kind: "phone", label: "Phones" },
  { kind: "tablet", label: "Tablets" },
  { kind: "ink", label: "E-readers" },
];

/** The size of a device with its body, which is what has to fit a pane. */
export function deviceBox(device: Device): { width: number; height: number } {
  return {
    width: device.width + device.bezel.left + device.bezel.right,
    height: device.height + device.bezel.top + device.bezel.bottom,
  };
}

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
  /** The room at each side of the text. */
  margins: ReaderMargins;
  /** The room above and below the text. */
  vertical: ReaderMargins;
  /** Unset keeps the author's alignment. */
  align: ReaderAlign | undefined;
  theme: ReaderTheme;
}

export const READER_DEFAULTS: ReaderSettings = {
  font: "publisher",
  size: 100,
  spacing: undefined,
  margins: "normal",
  vertical: "normal",
  align: undefined,
  theme: "light",
};

/** The name each setting goes by in the reader settings. */
export const READER_LABELS: Record<keyof ReaderSettings, string> = {
  font: "Font",
  size: "Text size",
  spacing: "Line spacing",
  margins: "Side margins",
  vertical: "Top and bottom",
  align: "Alignment",
  theme: "Theme",
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

/** The step a size is, counting from 1, and how many steps there are. */
export function readerSizeStep(size: number): { step: number; steps: number } {
  return {
    step: (size - READER_SIZE_MIN) / READER_SIZE_STEP + 1,
    steps: (READER_SIZE_MAX - READER_SIZE_MIN) / READER_SIZE_STEP + 1,
  };
}

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

export const READER_VERTICALS: readonly ReaderOption<ReaderMargins>[] = READER_MARGINS;

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

const INSETS: Record<ReaderMargins, number> = {
  narrow: 16,
  normal: 32,
  wide: 56,
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

/** The device and the reader settings the plugin keeps between panes. */
export interface ReaderStored {
  device: string;
  settings: ReaderSettings;
}

export const READER_STORED: ReaderStored = { device: DEVICE_DEFAULT, settings: READER_DEFAULTS };

function offered<Value>(options: readonly ReaderOption<Value>[], value: unknown, or: Value): Value {
  const found = options.find((option) => option.value === value);
  return found === undefined ? or : found.value;
}

/**
 * Reads the device and the settings back from the plugin's data. A
 * field the data lacks, or holds a value the lists do not offer for,
 * reads as that field's default and leaves the others as they were
 * saved. A setting left to the publisher is saved as no key at all.
 */
export function readerStored(value: unknown): ReaderStored {
  const saved = record(value);
  const kept = record(saved["settings"]);
  const size = kept["size"];
  return {
    device: DEVICES.find((device) => device.id === saved["device"])?.id ?? DEVICE_DEFAULT,
    settings: {
      font: offered(READER_FONTS, kept["font"], READER_DEFAULTS.font),
      size:
        typeof size === "number" &&
        size >= READER_SIZE_MIN &&
        size <= READER_SIZE_MAX &&
        (size - READER_SIZE_MIN) % READER_SIZE_STEP === 0
          ? size
          : READER_DEFAULTS.size,
      spacing: offered(READER_SPACINGS, kept["spacing"], READER_DEFAULTS.spacing),
      margins: offered(READER_MARGINS, kept["margins"], READER_DEFAULTS.margins),
      vertical: offered(READER_VERTICALS, kept["vertical"], READER_DEFAULTS.vertical),
      align: offered(READER_ALIGNMENTS, kept["align"], READER_DEFAULTS.align),
      theme: offered(READER_THEMES, kept["theme"], READER_DEFAULTS.theme),
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The page colour ReadiumCSS draws where a theme names none. */
const PAPER = "#FFFFFF";

/** The colour of the page in the reader's theme, which the screen around the text is painted in. */
export function readerPage(settings: ReaderSettings): string {
  return COLOURS[settings.theme]?.background ?? PAPER;
}

/**
 * The room a reading app leaves above and below the text, in CSS
 * pixels. ReadiumCSS has a variable for the sides alone, so an app
 * makes this room by setting its web view inside the screen. The room
 * also clears what the device keeps of the screen for itself.
 */
export function readerInset(
  settings: ReaderSettings,
  device: Device,
): { top: number; bottom: number } {
  const room = INSETS[settings.vertical];
  return { top: device.safe.top + room, bottom: device.safe.bottom + room };
}

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
