# The v1 design

Thirteen artboards draw the plugin: ten screens and three flows. Five
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
- `orca-tail.svg`, the tail mark from the orca icon, as flat paths in
  the current color. The site parts draw the same paths inline.
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
- One ribbon icon, the orca tail. A click on it shows the navigator.
  The count of warnings is the one on the preview bar, and the icon
  carries none.
- Each book's row in the navigator has `Open preview` beside `Add to
  this book`. The book note's page has `Open preview` in its header,
  beside `Open as markdown`.
- The preview's icon is an eye in a viewfinder. The book note's page
  keeps the closed book. The open book is Obsidian's reading view
  toggle, which sits beside `Open preview` on a note.
- `Open as markdown` on a preview opens the chapter it was opened
  from. A preview opened without a chapter opens the book note.
- A chapter click in the navigator turns a preview to that chapter
  when the most recent tab in the main area previews its book. A click
  with the Mod key opens the chapter as markdown in a new tab. Any
  other chapter click opens the note.
- The author's CSS is the design panel's second view, reached by an
  icon in the panel header. The book stays in the pane either way.
- The design panel is in the right sidebar, and it does not open or
  close with a book. It shows a book only while a preview of that book
  is visible. With no preview visible, it shows "No book is open". The
  book note's own page shows the design read-only.
- The panel draws margins and a custom trim in the unit from orca's
  settings. That unit is inches unless the author picks millimeters or
  points.
- A control the CSS overrides dims and shows a lock. A hover over the
  lock names the property, the value that overrides it and its line. A
  click on the lock goes to that line.
- The control for a key the book does not set shows orca's default in
  faint type. A key the book sets has a reset at the end of its row.
  The reset returns the key to the default.
- The stepper and the arrow keys change a number field by a step that
  suits its unit. If orca cannot read the value in a field, a line
  under the row shows the error.
- The Font control opens on the fonts the machine has, read out of the
  platform's font directories and the vault's `fonts/`. Typing filters
  that list rather than naming a font. Each row is set in its own
  font.
- A family whose faces come in more than one variant, such as a
  condensed width, shows a Variant row under Font. A family with one
  variant shows none. A book with no variant picked sets in the
  family's default variant, and each variant row is set in its own
  face.
- Export sits in the book preview's toolbar and on the book note's
  page.
- A change on disk reloads a book view with no unwritten edit. A view
  with one asks the author which version to keep.
- Chapter openings default to the next page. The right-hand page and
  the same page are the other choices.
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
- Inspect mode is an action in the book view's header, beside the swap
  to the manuscript, and it is also a command. While it is on, the box
  under the pointer is outlined on the page, with a tag that names its
  element. Content, padding and margin each get a light tint.
- A click pins the box. The pin opens a pane at the top of the design
  panel's CSS view, above the editor, and turns the panel to that view.
  The pane shows the box's ancestors as crumbs, the rules that matched
  it grouped by the layer they came from, and a few computed values.
- The crumbs and the rules use the selectors the engine matches. A
  section is named by its id, as `section#chapter-twelve`, and its
  class shows beside the id in faint type. The class is the section's
  role. The design panel's rules name a section by its id too.
- The pane lists only the rules that match the box itself. A
  declaration the engine skipped shows inside its rule with the
  engine's warning.
- A rule from the author's CSS names its line, and a click puts the
  cursor on that line. A rule from the design panel names the control
  that wrote it, and a click opens that control. A rule for a layout
  that has no control, such as the title page, opens nothing.
- `Add a rule` puts an empty rule at the cursor. Its selector starts
  with each ancestor up to the nearest one with an id, and names an
  element by its id or its classes. A click on a crumb takes it out of
  the selector or puts it back.
- A box split across two pages is outlined on both pages. A running
  head is picked as a margin box of its `@page` rule.
- The first Escape removes the pin. The second Escape turns inspect
  mode off. A click on the pinned box again, a click where there is no
  box, and the pane's close button each remove the pin too. The action and a swap to the manuscript also turn it off.
- Inspect mode waits on fleuron to find the box under a point and to
  return the rules that matched it and its computed values.

## What the site settles

- The site's look is Deep water: black `#0a0c0f`, white `#eef0ec`, and
  ink indigo, `#6366f1` on dark and `#3730a3` on light. Dark is the
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
- The main button is black on the white sea and ink indigo on the black
  sea.
- The sea surface moves, and the sea gets darker toward the end of the
  page. With reduced motion on, the sea holds still.
- A screenshot of Obsidian takes the site's colors and fonts. At phone
  width, the landing page shows the preview pane alone.
- The site's sample book is Twenty Thousand Leagues Under the Sea. A
  plate from the illustrated edition of 1871 takes the page facing
  Chapter I. The plate is a note that holds the embed and nothing else,
  so it takes a page of its own and the chapter keeps its opening.
