# Prose style

The voice the README, `design/README.md` and the issue and PR bodies are
written in. CLAUDE.md's documentation rules still hold. This says what
the voice is once they are satisfied.

## Voice

### Subject first, then verb

No inverted openers, no clause that holds the subject back.

Before:

> Reach for a cache, and the second render costs nothing.

After:

> The second render reads from the cache.

### No epigrams

A sentence whose job is to be pleasing gets cut, however true it is.

> A name is a promise the rest of the code has to keep.

### No personification

A file, a pane or a warning does not say, know, want or announce
anything.

Before:

> The navigator says where a chapter belongs. The warning says which
> face was wanted.

After:

> The navigator sets where a chapter belongs. The warning names the
> face that was asked for.

An author, a host or a reader is a party to the contract rather than a
tool, and may still want things.

### No stand-ins

A description standing in for a name, or a figure of speech standing in
for the plain verb or preposition, leaves the reader to work out what
was meant. Use "is" and "has" where they fit.

Before:

> the module the build left beside `main.js`
>
> Its value names the format.
>
> The engine opens over the module.

After:

> `fleuron_bg.wasm`, in the plugin's install directory
>
> Its value is the format.
>
> The engine opens from the module.

"names" belongs where something carries a name, as the warning above
does.

### No riddles

State the thing, then show it. Do not describe a shape and leave the
reader to find it.

Before:

> Five modules, one direction.

After:

> An edit does four things: reads the notes, plans an op, sends it to
> the session, and paints the page that comes back.

### Stop at the fact

A sentence that explains, justifies or admires the fact before it ends
at the fact instead.

Before:

> Preview and export share a session because a second one could
> paginate differently. One session cannot disagree with itself.

After:

> Preview and export share a session.

### Plain beats clever, even when clever is shorter

"can be used to" is fine. Compression is not the goal.

## Code comments

CLAUDE.md says when a comment exists. This says how one reads. The
rules above hold here too.

A doc comment is a label or a sentence with a verb. A label names the
thing. A sentence says what the function does, in the present tense.
Anything else is a puzzle the reader solves to get the label back.

Before:

> What a new chapter is called before the author names it.
>
> The note opened: the model read, the writer made, the book painted.
>
> A note, opened in the active pane.

After:

> The default chapter name.
>
> Reads the model, makes the writer and paints the book.
>
> Opens a note in the active pane.

The shapes that make a puzzle:

- An opener of "What", "How", "Which", "Where", "Who" or "The way".
  The lint pass rejects these.
- A noun and a participle standing in for a verb. "The shelf, drawn"
  is "Draws the shelf".
- A definition by story. "The book a folder of notes becomes" is "The
  book note for a folder".
- A colon and a list of parts. Say the whole. If the parts matter they
  are the fields, and each field carries its own comment.
- Three things in a row for rhythm.

A plain restatement beats a puzzle. When the only true thing to say is
what the signature already says, write nothing.

A commit subject is imperative and says what changed: "Rename the
default section heading". No wordplay, no clause that holds the
subject back.

## Words

Use the ordinary word. A trade word belongs where it is the API's own
term, not in explanation.

One name per concept, used everywhere: in prose, in code comments, in
strings, in headings, in test ids, and in filenames. A rename is
finished when nothing in the repo still uses the old name.

Name commands and settings the way the reader types them, in backticks.

A feature that is missing is not supported yet, not refused. Nothing
frames a gap as a decision against it.

## What does not go in a page

Numbers measured somewhere else. Timings, page counts and stage counts
belong on the page that measures them, and go stale everywhere else.

Sample output that drifts. Either a test checks the number or it stays
out.

Anything another page already says. One page owns a fact and the rest
link to it.

The future. No "when it ships", no "this will change".

History. What a page used to say is in git.

Claims wider than the code. "Nothing blocks the UI thread" is a claim
about every book anyone will ever open.

The reader's possessions. Describe what the code does, not what the
reader owns: "hands the note to your parser" is "parses the note".

Implementation detail, for a reader outside the repo. What a command
does and what comes back is theirs. How it is done is not. Test names,
CI jobs and the module map belong in CLAUDE.md. A section whose heading
says it is for someone building the repo is the exception.

## Shape of a page

Headings are labels a reader scans and a search box matches, not lines
of prose. Page titles are sentence case.

A quickstart opens with install, then the one action that produces a
page, then what came back.

A section that explains a mechanism ends in a snippet that runs it. A
snippet that is also a file in the repo is held against that file by a
test, so the page cannot drift from the code.

A reference table links out rather than carrying a paragraph inline.
The page that owns a detail is the page that carries it.

## Links

The README and `design/README.md` link: to the engine, to source, to
the projects the code depends on. CLAUDE.md's rule against links covers
code comments and internal notes.
