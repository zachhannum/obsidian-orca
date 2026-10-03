# The v1 design

Fourteen artboards draw the plugin on the desktop: eleven screens and
three flows. Nineteen more draw it on a phone and a tablet, and five
draw the docs site. They show orca as it is meant to look and behave. They are HTML rather than pictures, so they can be edited and
rebuilt instead of redrawn.

Obsidian's own tokens are lifted from `app.css` in the installed
build: its colour ramp, the 40px header, the 44px ribbon, 13px
navigation type, its radii. They are in `chrome.css`. New surfaces
extend that vocabulary rather than inventing one.

Obsidian mobile's tokens are in `chrome.css` too, under `.is-mobile`,
`.is-phone` and `.is-tablet`, the classes `app.css` keeps them under.
A mobile part draws its device as a `.device` frame with those
classes, and every measurement inside the frame is the mobile one.

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
- `canvas.html`, the page that draws the canvas in a preview.

## Rebuilding

```
node build.mjs
```

Every part becomes a `.dc.html` beside it. Those are generated; edit
the parts.

```
node build.mjs --into <dir> --against <ref>
```

This writes a page a browser opens for each part, and an index that
draws `canvas.json` as a canvas: every artboard where it sits, live, with
the parts changed against `<ref>` marked. Drag or scroll to pan, pinch or
hold ctrl and scroll to zoom, tap an artboard to open it. A pull request's
preview is built this way.

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
  to the page the pane is showing most of, and turning a page scrolls
  the manuscript to the line that page opens at. A block half off the
  top of the pane counts for the half on screen, so a sliver of a
  heading does not outweigh the page under it. A note the book does not
  list, and a page of generated matter, move neither pane. The link stops at the paragraph, because a byte of markdown
  and a byte of set text are not the same byte. `Open manuscript to
  the left` is the same split from the book's side.
- The preview keeps the page it is on, so a swap to the manuscript and
  back opens on it, mid-chapter included, and a workspace reopened at
  startup opens the preview where it was closed.
- `Open preview` on a note opens the book at the page the manuscript is
  showing most of, unless that is still the page the book was left on. A reader who paged through the book comes back to
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
- `Open as ...` swaps one note between its views: `Open as markdown`
  and `Open as book page`. `Open preview` opens the book's preview,
  from a chapter, the book note's page and the navigator.
- Opening a preview reveals the design panel in the right sidebar.
- `Open as markdown` on a preview opens the note the page being read
  opens in, at the line that page opens at. A page of generated matter
  opens the note read last. If no note was read, it opens the nearest
  note in the reading order. Only a book with no notes opens the book
  note.
- If the most recent tab in the main area previews a book, a click on
  a chapter or a generated section of that book in the navigator turns
  the preview to it. A click with the Mod key opens a chapter as
  markdown in a new tab. Any other chapter click opens the note.
- The navigator lists the headings inside each entry's note under the
  entry, read from Obsidian's cache. A note that opens on a heading
  with the entry's name leaves it out, because the entry's row says
  it. The author folds the headings of one entry at a time, and a
  heading folds the deeper headings under it. `Collapse all` in the
  navigator header folds every book, every entry and every heading
  level, and `Expand all` opens them all again. It is there whenever
  the shelf has a book. Obsidian keeps every fold with the
  workspace, so a reload opens the shelf as the author left it. A
  heading's fold follows its words under the headings above it, so
  text written elsewhere in the note keeps it. A setting
  lists them, and it is off until the author turns it on. A second setting sets the deepest heading
  level the navigator lists, and a heading below it has no row. A heading row turns a preview of the book to
  the page the heading opens on, and a Mod click opens the note at its
  line. A heading row never drags, and a dragged entry folds its
  headings until it is dropped. The row for the page the preview
  shows is marked, heading rows included.
- The author's CSS is the design panel's second view, reached by an
  icon in the panel header. The book stays in the pane either way.
- The design panel is in the right sidebar, and it does not open or
  close with a book. It shows the book on screen: a preview of it, and
  with no preview drawn, a note of it. The active note names the book,
  and otherwise the first note on screen does. The panel reads the
  session the book already has. It sets no book and holds no engine,
  because a book is set by a view that reads it.
  With no preview and no note of a book on screen, it shows "No book is
  open". The book note's own page shows the design read-only.
- The panel draws margins and a custom trim in the unit from orca's
  settings. That unit is inches unless the author picks millimeters or
  points.
- A control the CSS overrides dims, takes no input and shows a lock. A
  hover over the lock names the property, the value that overrides it
  and its line. A click on the lock goes to that line.
- The control for a key the book does not set shows orca's default in
  faint type. A key the book sets has a reset at the end of its row.
  The reset returns the key to the default.
- The stepper and the arrow keys change a number field by a step that
  suits its unit. If orca cannot read the value in a field, a line
  under the row shows the error.
- The Font control opens on the fonts the machine has, read out of the
  platform's font directories and the vault's `fonts/`. On iOS those
  are the phone's system faces and the faces a configuration profile
  installed. Typing filters that list rather than naming a font. Each
  row is set in its own font.
- The list leaves out a face the platform keeps for its own interface.
  The family name of such a face opens with a dot, as SF's does. This
  holds on a phone as on a Mac.
- A family whose faces come in more than one variant, such as a
  condensed width, shows a Variant row under Font. A family with one
  variant shows none. A book with no variant picked sets in the
  family's default variant, and each variant row is set in its own
  face.
- The Glyph row offers four ornaments and a browser over the face the
  scene break is set in. The browser lists every code point that face
  covers, under the name of the Unicode block the code point sits in.
  An ornamental font holds its ornaments where it likes, so the browser
  hides no block.
- The Fonts group follows Headings and adds a font the design names
  nowhere. The picker is the Font control's, and a font added this way
  registers a face, so the author's CSS can set text in it by name. The
  row is set in that font, and the cross at its end takes it back out.
  A font the machine no longer has warns the way a missing design font
  warns.
- A font the design names and the machine does not have is an error,
  as it is at export. The preview lists it with the warnings, in a
  group named `Fonts`, on a red card. The count says each kind, as in
  `1 error, 2 warnings`, and is red when it holds an error. The
  panel's header counts the errors as the CSS view counts its
  warnings.
- A `font-family` value in the CSS view completes from the fonts the
  book carries, the design's and the added ones. A name goes in quoted.
  A selector completes from the classes and ids the book's sections
  carry, after a `.` or a `#`, and from the ones its notes write, as
  the engine read them at the last render. Property names, their keywords, the
  elements, pseudo-classes and at-rules complete from the subset the
  engine exports, and from no list orca keeps. A name inside `var(`
  completes from the custom properties the sheet declares, and one
  inside `string(` from the names its `string-set` declarations set. An option
  shows an Obsidian icon for its kind and its syntax on a line under
  its name, and Tab takes it.
- Export sits in the book preview's toolbar and on the book note's
  page.
- Export lists every format with a checkbox, and every box is ticked
  when the dialog opens. One export writes one file for each ticked
  format. The files share one path, and each format adds its own
  extension. `Choose…` picks a folder, not a file.
- EPUB is the preview's fourth view, beside the three page views in
  the bar's segmented control. It shows the engine's EPUB in a frame
  that ReadiumCSS pages, and no page is laid out for it. The reading is
  ReadiumCSS's, not one reading app's.
- A device in the EPUB view is a named one, in three groups. Phones
  are iPhone at 393 × 852 and Android phone at 412 × 915. Tablets are
  iPad at 820 × 1180, Android tablet at 800 × 1280 and Kindle Fire at
  601 × 962. E-readers are Kindle Paperwhite at 632 × 840, Kobo Clara
  at 536 × 724 and Nook GlowLight at 536 × 724. The pane opens on the
  Kindle Paperwhite.
- A device's size is its screen in CSS px. An e-reader has no browser
  to measure, so its size is approximate: the panel's resolution
  halved.
- A device is drawn with its body. A phone has its camera and the bar
  that goes home. A tablet has an even bezel with a camera in it. An
  e-reader has a matte body with a thicker chin, and its screen has no
  colour. A device larger than the pane scales down to fit, body
  included.
- The EPUB view has seven reader settings. Font is Publisher, Old
  style, Modern, Sans or Humanist. Text size is a smaller letter and a
  larger one, with the step between them. It has eight steps and
  starts at the second, which is the publisher's. Line spacing is Publisher, 1.2, 1.5, 1.75
  or 2. Side margins are Narrow, Normal or Wide. Top and bottom are
  Narrow, Normal or Wide. Alignment is Publisher, Start or Justify.
  Theme is Light, Sepia or Dark. Each starts at the publisher's, which
  is the author's CSS. A setting moved off it overrides the CSS as a
  reading app does.
- The top and bottom margins set the text inside the screen, as a
  reading app sets its web view. On a phone they also clear the camera
  and the bar that goes home.
- The EPUB view turns a screen at a time, then to the next section. In
  it the chapter select, the folio, the total and the page arrows give
  way to the device select, a settings button that opens the settings
  under it, and previous and next. A status such as "section 6 of 9 ·
  screen 2 of 14" is under the device.
- The EPUB view, the device and the reader settings are kept. The
  plugin's data keeps all three, so the next preview opens as the last
  one was left, and the pane's own state keeps the view, as it keeps a
  page view. No note is written.
- Inspect is off in the EPUB view.
- A change on disk reloads a book view with no unwritten edit. A view
  with one asks the author which version to keep.
- Chapter openings default to the next page. The right-hand page and
  the same page are the other choices.
- A heading level, a chapter's first line and the running heads each
  take capitals and tracking. A title's own type sits with the level it
  is written at, not with the chapter's layout, and so does the space
  above and below it.
- One font style control sets the weight and the slope. It is a menu
  of Normal, Bold, Italic and Bold italic, drawn like the Variant row,
  and each name is set in the style it names. Each heading level, the drop cap, the scene break, the running
  heads and the folio each take one. Body text takes none, because the
  note marks its bold and italic. Bold or italic written inside a
  heading still comes from the note. A chapter's first line takes no
  style, because the engine sets none there.
- A running head set to the chapter title reads the section's first
  heading, whatever level it is written at. The Headers & page
  numbers group picks the level to read instead, and a chapter with no
  heading there reads its first.
- The running heads take a font of their own, and the folios take
  another, because a head is usually set in another face than the text
  and a folio in another face again. Neither row has a Variant row, so
  each sets in its family's default variant. A head or a folio with no
  font of its own is set in the book's font, and its row shows that
  font the way a heading's Font row does.
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
- A click on a drop cap pins the paragraph's `::first-letter`, and the
  outline is the letter alone. A first line, a `::before` and an
  `::after` are pinned the same way. The tag and the last crumb name
  the pseudo-element, and the crumb before it names the element it
  belongs to. The two are the leaf of the selector, so neither comes
  out of it, and only the ancestors above them toggle. A click on the
  crumb for the element pins the element, and its rules take the place
  of the pseudo-element's.
- The first Escape removes the pin. The second Escape turns inspect
  mode off. A click on the pinned box again, a click where there is no
  box, and the pane's close button each remove the pin too. The action and a swap to the manuscript also turn it off.
- Inspect mode waits on fleuron to find the box under a point and to
  return the rules that matched it and its computed values.
- A book's notes carry fleuron's markdown, and the editor draws the
  marks Obsidian draws as prose: an attribute run, a setext heading of
  more than one line, and a break command. Everything else a note is
  written in is Obsidian's own, unmarked, because the engine is the
  only linter.
- A run is drawn as a chip that names it the way inspect names a box:
  the id first, as `#opening`, then each class in written order, as
  `.epigraph`, with the id accented and the classes faint. The braces
  are not drawn, because the chip is where they were. A run the engine
  reads and cannot use is drawn as it was written.
- A chip sits where its run was written. An attribute line's chip is
  on that line, above the block it names. A heading's is at the end of
  the heading, in body size. An image's is under the image. A span's
  is at the end of the span, and the brackets around its text come
  off.
- The line the cursor is on shows its source, the way Live Preview
  shows every other mark. The rest of the note keeps its chips.
- A setext heading is drawn at the level of its underline. The editor
  keeps the underline, faint, because the line is still there to type
  on. Reading view draws no underline at all.
- `\pagebreak` and `\columnbreak` at the head of a line of their own
  are drawn as a rule across the measure, named for the command they
  came from. The page break's rule is solid and the column break's is
  dashed, so the two read apart at a glance.
- A break command indented four spaces is the code block it is, and
  one written inside a paragraph is the prose fleuron paints.
- Where a run is comes from orca's own parse of the note, which reads
  the markdown fleuron reads. A run orca cannot place stays prose.
  Obsidian's outline and heading search use Obsidian's parse, so a
  setext heading of more than one line is in neither.
- A chip is what the editor draws, and the engine still settles the
  page. A chip that disagrees with the book is wrong in the editor and
  not in what was set. A test holds the two parses against each other
  over every note of the fixture vault.
- Drawing a chapter starts no engine and lays out no pages. A note is
  drawn from the text in front of it, so a chip lands on the keystroke
  that made it and a chapter with no preview open takes its marks. A
  note no book lists takes none.

## What the screens settle on mobile

The answers above hold on a phone and a tablet unless one of these
replaces them.

- A screen has a phone artboard and a tablet artboard, named for the
  desktop one: `MainPhone`, `MainTablet`. `FlowMobileDraftLoop` draws
  the draft loop on a phone.
- The design panel is in the right drawer on a phone and on a tablet.
  Opening a book puts its design in the drawer and leaves the drawer
  shut. Orca opens no drawer on its own, except for an inspect pin on
  a tablet. On a tablet the drawer pins
  beside the view, and the panel and the page are on screen together.
- A phone has one pane. The header action swaps it between a chapter
  and its page, as on desktop, and the pane keeps the page and the line
  as it does there. `Open preview to the right` and `Open manuscript to
  the left` are not offered on a phone. A tablet offers both.
- A phone and a tablet offer the three views of the desktop. A phone
  on its side shows a spread at the height of the pane. Upright, the
  spread is drawn at the width of the screen.
- A swipe turns a page, a spread or a screenful. The arrows that turn
  a page stay, beside the page number.
- EPUB is the fourth view on a phone and on a tablet. Its controls are
  the settings button, the device select and the two arrows, each as
  tall as a touch. They go where the page's foot goes. Under the page
  they fill the foot, and in the bar they sit before Export.
- The count of warnings is drawn in the EPUB view too, beside the EPUB
  controls. Under the page the controls leave no room for words, so
  the count is an icon and a number at the left of the foot, one touch
  wide. It is red if there is an error and orange if not, and its label
  and the warnings it opens say the rest. In the bar it keeps its
  words, just before the controls. A tap on it opens the warnings, as
  it does in the page views.
- The reader settings open above their button under the page, as the
  warnings do, and hang under it in the bar. The sheet is opaque and
  drawn over the device. The arrows turn a screen and then the
  section. The EPUB view has no swipe.
- Mobile has no status bar. On an upright phone the page number, the
  arrows and the count of warnings are under the page, clear of
  Obsidian's own bar. On a phone on its side they are in the preview's
  bar. A tablet has them in the bar too, in a pane 700px wide or more,
  and under the page in a narrower one. The warnings open over the
  page from the count, and a tap on the page shuts them.
- The navigator's buttons are Obsidian's own, drawn the way the file
  explorer draws its row on each device. They are `New book`, a search, a sort and `Collapse all`, which
  is last as in the file explorer. Each acts on the whole shelf.
  An action on one book stays in that book's row. `New book` is a book
  with a plus on it, on desktop too. On desktop the row is centered along
  the top of the pane. On a tablet it is a pill at the top. On a phone
  it is centered along the bottom, above the pane picker, and the list
  fades out above it as it does in the file explorer.
- Nothing on mobile waits for a pointer. A tap on a lock opens its
  card. A book's row in the navigator shows `Open preview` and `Add to
  this book` at all times, and a missing note shows `Locate` and
  `Remove`. The fold chevrons in the CSS view are always drawn, and
  the card for a flagged declaration shows while the caret is in it.
  No control has a tooltip.
- A long press on a navigator row opens its menu: a sheet on a phone,
  a menu beside the row on a tablet. `Open as markdown` in that menu
  takes the place of the Mod click.
- A chip in the editor has no hover on any platform. A tap on its line
  puts the caret there, and the line shows its source.
- A link in the preview has no hand over it. A tap follows it, and a
  long press selects text.
- A row the navigator can move ends in a drag handle on mobile, and a
  drag starts only from the handle. A section has one at the end of its
  rule. A heading row has none.
- With a preview of the book open, a tap on a chapter turns it and
  closes a drawer that is not pinned.
- Every control on mobile is at least 44px on its short side, which is
  the size of Obsidian mobile's own buttons. A number field steps from
  a button at each end.
- The export dialog on mobile saves into the vault. It has a path in
  the vault and no `Choose…`. Once the file is written, `Share` hands
  it to the system share sheet, on a device that can share a file. The
  file stays in the vault whether or not it is shared.
- The Font control on mobile lists the fonts orca can read there: the
  system's on a device that lets orca read them, and the families in
  the vault's `fonts/`. Where orca can read no system fonts and
  `fonts/` has none, the list has the face orca carries, and a line
  under it names that folder.
- The CSS view is the design panel's second view on a phone and a
  tablet, as on desktop. A tap on the line in a lock's card opens it at
  that line.
- Inspect mode on a phone and a tablet is the desktop's, with a tap
  for the click. A touch screen has no pointer, so no box is outlined
  before the tap.
- On a tablet a pin opens the pane at the top of the CSS view and
  turns the panel to that view, as on desktop. A pin opens the right
  drawer when it is shut. It is the one thing orca opens a drawer for.
- On a phone the right drawer covers the page, so the pane is a sheet
  over the foot of the page instead. It rises when a box is pinned,
  with the crumbs and the first rule that matched. Pulled up, it has
  every rule, the computed values and `Add a rule`. Pulled down past
  its foot, it closes and removes the pin. The page moves up when the
  sheet would cover the pinned box.
- On a phone a tap on a rule's line, on the control that wrote a rule,
  or on `Add a rule` opens the right drawer at that place. The pin is
  kept.
- `Inspect the page` is the target in the book view's header on a
  phone and a tablet, as on desktop. On a phone the header is narrow,
  and the title is cut short to make room for it.
- A phone is drawn with Obsidian's bar along the bottom edge. A build
  of Obsidian that floats that bar changes nothing orca draws.

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
  title, and the title's letters invert below the waterline.
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
