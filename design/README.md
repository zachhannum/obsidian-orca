# The v1 design

Twelve artboards draw the plugin: nine screens and three flows. Five
more draw the docs site. They show orca as it is meant to look and
behave. They are HTML rather than pictures, so they can be edited and
rebuilt instead of redrawn.

Obsidian's own tokens are lifted from `app.css` in the installed
build: its colour ramp, the 40px header, the 44px ribbon, 13px
navigation type, its radii. They are in `chrome.css`. New surfaces
extend that vocabulary rather than inventing one.

The docs site does not use Obsidian's tokens. Its own are in
`site.css`.

## What is here

- `parts/*.html`, one file per artboard, the body only. The design
  lives here.
- `chrome.css`, Obsidian's tokens and the shared component classes.
- `site.css`, the docs site's tokens for both schemes and its
  component classes. A site part picks its scheme with `.site-dark`
  or `.site-light`.
- `parts/site-*.js`, the scripts that move the site's sea and run its
  demos.
- `orca-fluke.png`, the tail mark, as a mask.
- `sizes.json`, each artboard's frame in pixels. A site part also
  names its stylesheet, its script and its tweaks.
- `canvas.json`, where the artboards sit, the pages, the sticky notes.
- `build.mjs`, which wraps each part into a `.dc.html`.

## Rebuilding

```
node build.mjs
```

Every part becomes a `.dc.html` beside it. Those are generated; edit
the parts.

Publishing the canvas needs Claude Code's `design` skill, which seeds
its editor around these files and returns a URL. The artboard list and
`canvas.json` are what it takes. The site's artboards also take
`orca-fluke.png`.

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
- The Font control opens on the fonts the machine has, read out of the
  platform's font directories and the vault's `fonts/`. Typing filters
  that list rather than naming a font, and a row is set in the font it
  offers. The styles under it are the ones the engine registered, since
  a variable file's styles are not in its name table.
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
- A book whose engine dies is set again on a new one. It crosses as
  orca last sent it rather than as the vault holds it, and the pages
  already painted stay under the notice that says so.
- A fault that comes back on the same book would set it again for
  ever, so the second death holds those pages and offers what each
  death said. Opening the book again is the author's own try.
- No implementation vocabulary reaches a surface. The per-stage counts
  stay as attributes for the tests, and the status line reads the page
  the author is on.

## What the site settles

- The site's look is Deep water: black `#0a0c0f`, white `#eef0ec`, and
  glacier blue, `#86cfe0` on dark and `#1d6b7d` on light. Dark is the
  default.
- Titles are Bodoni Moda, and the second line of a title is italic.
  Reading text is Source Serif 4, the interface is Archivo, and code is
  DM Mono.
- The mark is the tail from the orca icon, in one flat color. The site
  does not use the colors of the icon.
- On the landing page, the sea rises through the second line of the
  title. The title is the light color with a difference blend, so its
  letters invert below the waterline.
- In the dark scheme, the landing page has a light sky over a black
  sea, and most of the page is dark. The light scheme swaps the two.
- The main button is black on the white sea and glacier on the black
  sea.
- The sea surface moves, and the sea gets darker toward the end of the
  page. With reduced motion on, the sea holds still.
- A screenshot of Obsidian takes the site's colors and fonts. At phone
  width, the landing page shows the preview pane alone.
- The site's sample book is Twenty Thousand Leagues Under the Sea.
  Chapter I opens with a chapter-head image, which is an embed at the
  top of the chapter note.
