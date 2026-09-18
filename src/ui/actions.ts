/**
 * The icon and the label of each button the docs name. The docs site
 * draws the same pair inline, so a button renamed here is renamed on the
 * page that names it. Nothing here touches Obsidian, since the site
 * imports this module too.
 */
export interface Action {
  icon: string;
  label: string;
}

export const ACTIONS = {
  preview: { icon: "scan-eye", label: "Open preview" },
  markdown: { icon: "file-text", label: "Open as markdown" },
  export: { icon: "download", label: "Export to PDF" },
  inspect: { icon: "crosshair", label: "Inspect the page" },
  unpin: { icon: "x", label: "Take the pin off" },
  css: { icon: "code", label: "CSS" },
  controls: { icon: "sliders-horizontal", label: "Controls" },
  wrap: { icon: "wrap-text", label: "Wrap long lines" },
  newBook: { icon: "plus", label: "New book" },
} as const satisfies Record<string, Action>;
