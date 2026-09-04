# Orca

A book designer that lives inside Obsidian. The chapters stay notes in the vault, the book is a note beside them, and a preview pane shows the set page while you write.

The setting is done by [fleuron](https://github.com/zachhannum/fleuron), running as WebAssembly in a worker: markdown in, laid-out pages out, styling as CSS, no DOM anywhere. Orca is the half fleuron does not have — a project, a design UI, and a place to put the result.

Desktop only.

## Three invariants

1. The panel never writes the author's CSS. Settings are data; the CSS they imply is generated at render time and never lands in the vault.
2. The engine is the only linter. Every squiggle in the CSS editor comes from a fleuron warning.
3. Preview and export come from one session. The PDF is drawn from the pages already on screen.

## Building

```
npm install
npm run dev
npm test
```

`main.js` and the engine's `.wasm` are written beside `manifest.json`. Symlink the repo into a vault's `.obsidian/plugins/orca/` to run it.

## Status

The engine starts. Nothing is on screen yet. The build order is milestones M0 through M4, and the tracking issue is #1.
