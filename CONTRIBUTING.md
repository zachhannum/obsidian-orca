# Contributing

Orca is an Obsidian plugin for the desktop. The typesetting is done by [fleuron](https://github.com/zachhannum/fleuron), running as WebAssembly in a worker: Markdown in, typeset pages out, styling as CSS. Orca adds the project, the design UI and the export.

## Three invariants

1. The panel never writes the author's CSS. Settings are data. The CSS they imply is generated at render time and never goes into the vault.
2. The engine is the only linter. Every squiggle in the CSS editor comes from a fleuron warning. Orca parses a note to draw the chips over its attribute runs, and that parse settles no page.
3. Preview and export come from one session. The PDF is drawn from the pages already on screen. The EPUB comes from the same session and uses the same notes, CSS, faces and images. It uses no pages: a reading system makes its own pages, and the preview does not show them. The engine drops the page rules from the EPUB and gives no warning for them.

## Building

```
npm install
npm run dev
npm run lint
npm test
npm run e2e
```

The build writes `main.js` beside `manifest.json`, with the engine inside it. To run it, symlink the repo into a vault's `.obsidian/plugins/orca/`.

The docs site in `docs/` is its own npm package. Run `npm install` and `npm run dev` in that folder.
