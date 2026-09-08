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
- `Open preview to the right`, on a chapter's own menu, splits instead
  of swapping, and the two panes follow each other paragraph by
  paragraph. What the panes follow is what is scrolled into view, not
  the caret: reading a draft is scrolling, and a caret that never
  moves would turn nothing. Scrolling the manuscript turns the preview
  to the page the line at the top of the pane is set on, and turning a
  page scrolls the manuscript to the line that page opens at. A note
  the book does not list, and a page of generated matter, move neither
  pane. The link stops at the paragraph, because a byte of markdown
  and a byte of set text are not the same byte. `Open manuscript to
  the left` is the same split from the book's side.
- The preview keeps the page it is on, so a swap to the manuscript and
  back opens on it, mid-chapter included, and a workspace reopened at
  startup opens the preview where it was closed.
- The icon on a note opens the book at the page the manuscript is
  scrolled to, unless the pane is still scrolled inside the page the
  book was left on. A reader who paged through the book comes back to
  the line that page opens at, with the caret on it. One who turned no
  page comes back to the line they were writing on.
- One ribbon icon, with the issues badge on it.
- The author's CSS is the design panel's second view, reached by an
  icon in the panel header. The book stays in the pane either way.
- A control the CSS has taken over dims where it sits and shows the
  line that took it, which is also the way to that line.
- The Face control opens on the families the machine has, read out of
  the platform's font directories and the vault's `fonts/`. Typing
  filters that list rather than naming a family, and a row is set in
  the face it offers. The styles under it are the cuts the engine
  registered, since a variable file's cuts are not in its name table.
- Export sits in the book preview's toolbar and on the book note's
  page.
- A change on disk reloads a book view with no unwritten edit. A view
  with one asks the author which version to keep.
- Chapter openings default to the right-hand page, which is what
  leaves the odd blank verso. Next page and same page are both there.
- A section groups the reading order and gives no role. It is made,
  renamed, dragged and taken out the way a folder is, and an entry
  carries its own role wherever it lands.
- The navigator deletes the book note and nothing else, after asking.
  Every note a book lists is borrowed, so `Remove from book` is the
  only thing an entry's own menu offers.
- No implementation vocabulary reaches a surface. The per-stage counts
  stay as attributes for the tests, and the status line reads the page
  the author is on.
