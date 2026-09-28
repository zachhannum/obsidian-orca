// Obsidian puts its DOM helpers on every window it opens, a popout
// included, and its typings declare them on the main window alone. A
// node drawn for a popout is made by that popout's `win.createDiv`.
interface Window {
  createEl: typeof createEl;
  createDiv: typeof createDiv;
  createSpan: typeof createSpan;
  createSvg: typeof createSvg;
}
