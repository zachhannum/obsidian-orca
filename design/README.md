# The v1 design

Twelve artboards: nine screens and three flows, drawn as orca is meant
to look and behave. They are HTML rather than pictures, so they can be
edited and rebuilt instead of redrawn.

Obsidian's own tokens are lifted from `app.css` in the installed
build: its colour ramp, the 40px header, the 44px ribbon, 13px
navigation type, its radii. They are in `chrome.css`. New surfaces
extend that vocabulary rather than inventing one.

## What is here

- `parts/*.html`, one file per artboard, the body only. The design
  lives here.
- `chrome.css`, Obsidian's tokens and the shared component classes.
- `sizes.json`, each artboard's frame in pixels.
- `canvas.json`, where the artboards sit, the two pages, the sticky
  notes.
- `build.mjs`, which wraps each part into a `.dc.html`.

## Rebuilding

```
node build.mjs
```

Every part becomes a `.dc.html` beside it. Those are generated; edit
the parts.

Publishing the canvas needs Claude Code's `design` skill, which seeds
its editor around these files and returns a URL. The artboard list and
`canvas.json` are what it takes.

## What the screens settle

- Manuscript and book are one pane, swapped by a single icon in the
  note's header. `MarkdownView` inherits `addAction` from `ItemView`,
  and the swap is `leaf.setViewState`, so the affordance costs no
  hand-built DOM in a view orca does not own.
- One ribbon icon, with the issues badge on it.
- The author's CSS is the design panel's second view, reached by an
  icon in the panel header. The book stays in the pane either way.
- A control the CSS has taken over dims where it sits and shows the
  line that took it, which is also the way to that line.
- Export sits in the book preview's toolbar and on the book note's
  page.
- A change on disk reloads a book view with no unwritten edit. A view
  with one asks the author which version to keep.
- Chapter openings default to the right-hand page, which is what
  leaves the odd blank verso. Next page and same page are both there.
- A section groups the reading order and gives no role. It is made,
  renamed, dragged and taken out the way a folder is, and an entry
  carries its own role wherever it lands.
- No implementation vocabulary reaches a surface. The per-stage counts
  stay as attributes for the tests, which contradicts the acceptance
  wording on the stage-counter issue.
