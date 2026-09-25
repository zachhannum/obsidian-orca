import assert from "node:assert/strict";
import test from "node:test";
import { headingWords, marksIn, namesOf, type Drawn, type Form, type Names } from "@/book/marks";

/** Each mark as its form and the text it covers, which is what a chip replaces. */
function covers(text: string): string[] {
  return marksIn(text).map((mark) => `${mark.form} ${JSON.stringify(text.slice(mark.from, mark.to))}`);
}

test("a paragraph of one brace run is an attribute line", () => {
  assert.deepEqual(covers("{#opening .epigraph}\n\nA paragraph.\n"), [
    'line "{#opening .epigraph}"',
  ]);
});

test("a brace run written inside a paragraph is prose", () => {
  assert.deepEqual(covers("A paragraph {#opening} and more.\n"), []);
});

test("a brace run inside a fenced block is the code it is", () => {
  assert.deepEqual(covers("```\n{#opening}\n```\n"), []);
  assert.deepEqual(covers("~~~\n{#opening}\n~~~\n"), []);
});

test("a brace run indented four spaces is the code it is", () => {
  assert.deepEqual(covers("A paragraph.\n\n    {#opening}\n"), []);
});

test("a brace run inside frontmatter is metadata", () => {
  assert.deepEqual(covers("---\ntitle: {#opening}\n---\n\nA paragraph.\n"), []);
});

test("a brace run inside a table cell is prose", () => {
  assert.deepEqual(covers("| a | b |\n| - | - |\n| {#one} | 2 |\n"), []);
});

test("a heading takes the run written after it", () => {
  assert.deepEqual(covers("# Chapter One {.opening}\n"), ['heading " {.opening}"']);
});

test("an image alone on its line takes the run written after it", () => {
  assert.deepEqual(covers("![Plate](plate.png){.full}\n"), ['image "{.full}"']);
});

test("a run after an image inside a sentence is prose", () => {
  assert.deepEqual(covers("See ![Plate](plate.png){.full} here.\n"), []);
});

test("a bracketed run closed by a brace is a span", () => {
  assert.deepEqual(covers("She said [no]{.spoken} again.\n"), ['span "{.spoken}"']);
});

test("a bracketed run with a blank before the brace is prose", () => {
  assert.deepEqual(covers("She said [no] {.spoken} again.\n"), []);
});

test("a span inside inline code is the code it is", () => {
  assert.deepEqual(covers("Type `[no]{.spoken}` here.\n"), []);
});

test("a setext heading is drawn at the level of its underline", () => {
  assert.deepEqual(covers("Chapter One\n===\n"), ['setext "==="']);
  assert.deepEqual(covers("Chapter One\n---\n"), ['setext "---"']);
});

test("a break command alone on its line is the break fleuron reads", () => {
  assert.deepEqual(covers("A paragraph.\n\n\\pagebreak\n\nAnother.\n"), [
    'pagebreak "\\\\pagebreak"',
  ]);
  assert.deepEqual(covers("A paragraph.\n\n\\columnbreak\n\nAnother.\n"), [
    'columnbreak "\\\\columnbreak"',
  ]);
});

test("a break command on the last line of a note with no newline is a break", () => {
  assert.deepEqual(covers("A paragraph.\n\n\\pagebreak"), ['pagebreak "\\\\pagebreak"']);
});

test("a break command indented four spaces is the code it is", () => {
  assert.deepEqual(covers("A paragraph.\n\n    \\pagebreak\n"), []);
});

test("a break command written inside a paragraph is prose", () => {
  assert.deepEqual(covers("A paragraph \\pagebreak and more.\n"), []);
  assert.deepEqual(covers("A paragraph.\n\\pagebreak\nAnd more.\n"), []);
});

test("a brace run over a row of dashes names the scene break under it", () => {
  assert.deepEqual(covers("A paragraph.\n\n{.scene}\n---\n"), ['line "{.scene}"']);
});

test("an attribute line fleuron cannot use is prose", () => {
  assert.deepEqual(covers("{opening}\n"), []);
  assert.deepEqual(covers("{#one #two}\n"), []);
  assert.deepEqual(covers("![Plate](plate.png){not a run}\n"), []);
  assert.deepEqual(covers("She said [no]{not a run} again.\n"), []);
});

test("a heading keeps a run fleuron reads and cannot use, drawn as it was written", () => {
  const [mark] = marksIn("# Chapter One {key=value}\n");
  assert.equal(mark?.form, "heading");
  assert.deepEqual(mark?.names, { id: undefined, classes: [], said: "key=value" });
});

test("a run names one id and every class in written order", () => {
  assert.deepEqual(namesOf("#one .two .three"), {
    id: "one",
    classes: ["two", "three"],
    said: "#one .two .three",
  });
});

test("a run of two ids is one fleuron cannot use", () => {
  assert.deepEqual(namesOf("#one #two"), { id: undefined, classes: [], said: "#one #two" });
});

test("the marks of a note come back in written order", () => {
  const text = "{#one}\n\n# Two {.three}\n\nFour [five]{.six}.\n";
  assert.deepEqual(covers(text), ['line "{#one}"', 'heading " {.three}"', 'span "{.six}"']);
});


// The engine's own reading of a note, which is what orca's parse has
// to agree with. The shape proposal and the span predicates below are
// what production asked the engine with before it parsed for itself,
// so this is a second opinion rather than the same code twice.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { Client, createEngine, type NodeSource } from "fleuron";
import { offsetOf } from "@/book/place";

const root = process.env["ORCA_ROOT"] ?? process.cwd();

/** The notes of the fixture vault, which the e2e suite opens in Obsidian. */
const FIXTURE = [
  "A note on the text.md",
  "Acknowledgements.md",
  "Chapter Fifteen.md",
  "Chapter Twelve.md",
  "Copyright.md",
  "Pride and Prejudice.md",
  "Volume the First.md",
];

/** A mark's form and the text it covers, which is how the two readings compare. */
type Covered = [Form, string];

/** Every mark the engine reads in a note, in written order. */
async function engineMarks(name: string, text: string): Promise<Covered[]> {
  const require = createRequire(import.meta.url);
  const engine = await createEngine({
    wasm: await readFile(require.resolve("fleuron/fleuron_bg.wasm")),
  });
  try {
    const client: Client = new Client({
      post: (request) => {
        engine.submit(request, (response) => {
          client.receive(response);
        });
      },
    });
    await client.preview([
      { op: "dialect", dialect: "obsidian" },
      { op: "split", level: 0 },
      { op: "book", sources: [{ name, text }] },
    ]);
    const asked = candidates(text);
    const answers: (NodeSource | undefined)[] = [];
    for (const candidate of asked) {
      const node = await client.nodeAt(name, candidate.byte);
      answers.push(node === null ? undefined : ((await client.sourceOf(node)) ?? undefined));
    }
    const bytes = new TextEncoder().encode(text);
    const decoder = new TextDecoder();
    return drawn(text, asked, answers).map((mark) => [
      mark.form,
      decoder.decode(bytes.subarray(mark.from, mark.to)),
    ]);
  } finally {
    engine.free();
  }
}

/** Every mark orca reads in a note, in the same shape the engine's come back in. */
function orcaMarks(text: string): Covered[] {
  return marksIn(text).map((mark) => [mark.form, text.slice(mark.from, mark.to)]);
}

/**
 * A place the engine is asked about, and the mark it would be. The
 * ask is made at the candidate's byte, and the answer's span settles
 * it.
 */
interface Candidate {
  form: Form;
  /** The byte of the note the ask is made at. */
  byte: number;
  /** The mark's own text, as bytes of the note. */
  from: number;
  to: number;
  /** The level an underline gives, on a setext heading alone. */
  level: 1 | 2 | undefined;
  /** The bracketed text a span run closes, on a span alone. */
  open: number | undefined;
  /** The run's own text, without its braces. Empty on a setext heading. */
  inside: string;
}

/** A line of a note: its text, and the byte the line opens at. */
interface Line {
  from: number;
  to: number;
  text: string;
}

/** The byte of the note a character of one line falls at. */
function byteIn(line: Line, at: number): number {
  return line.from + new TextEncoder().encode(line.text.slice(0, at)).length;
}

/**
 * Every place in a note that has the shape of a mark. The engine is
 * asked about each one, because a shape is not a parse: `{#one #two}`
 * on its own line has the shape of an attribute line and is prose.
 */
function candidates(text: string): Candidate[] {
  const found: Candidate[] = [];
  for (const line of linesOf(text)) {
    found.push(...spansOn(line), ...onLine(line));
  }
  return found;
}

/** The candidates a whole line makes: a break, an attribute line, an underline, an image run, a heading run. */
function onLine(line: Line): Candidate[] {
  const command = /^\\(?:pagebreak|columnbreak)[ \t]*$/.exec(line.text)?.[0];
  if (command !== undefined) {
    // The ask is made where the line opens, because a command under
    // four spaces is a code block whose own span begins at the
    // command and would read as a break.
    return [
      {
        form: command.trimEnd() === "\\pagebreak" ? "pagebreak" : "columnbreak",
        byte: line.from,
        from: line.from,
        to: byteIn(line, line.text.trimEnd().length),
        level: undefined,
        open: undefined,
        inside: "",
      },
    ];
  }
  // A blockquote holds attribute lines too, so the markers come off
  // before the shape is read.
  const opened = /^[\s>]*/.exec(line.text)?.[0].length ?? 0;
  const said = line.text.slice(opened).trim();
  if (said.startsWith("{") && said.endsWith("}")) {
    // The ask is made where the run's own text opens, because a
    // paragraph indented under three spaces is still a paragraph and
    // its span starts at the brace rather than at the line.
    const opens = byteIn(line, opened);
    return [
      {
        form: "line",
        byte: opens,
        from: opens,
        to: byteIn(line, line.text.trimEnd().length),
        level: undefined,
        open: undefined,
        inside: said.slice(1, -1),
      },
    ];
  }
  const level = underline(line.text.trim());
  if (level !== undefined) {
    return [
      { form: "setext", byte: line.from, from: line.from, to: line.to, level, open: undefined, inside: "" },
    ];
  }
  const run = trailingRun(line);
  if (run === undefined) return [];
  const whole = line.text.trim();
  // An image alone on its line is a block of its own, so the ask is
  // made where the line opens; a heading's run is asked about where it
  // opens, because the heading covers the whole line either way.
  const image = whole.startsWith("![");
  if (image) {
    return [{ ...run, form: "image", byte: line.from, level: undefined, open: undefined }];
  }
  if (!whole.startsWith("#")) return [];
  return [{ ...run, form: "heading", byte: run.from, level: undefined, open: undefined }];
}

/** The bracketed runs written inside a line: `[text]{.class}`. */
function spansOn(line: Line): Candidate[] {
  const found: Candidate[] = [];
  for (const match of line.text.matchAll(/\[/g)) {
    const open = line.from + match.index;
    const closed = closes(line, match.index);
    if (closed === undefined) continue;
    found.push({ ...closed, form: "span", byte: open, level: undefined, open });
  }
  return found;
}

/** The `{...}` written directly after the `]` that closes the text opened at `at`. */
function closes(line: Line, at: number): Run | undefined {
  const shut = line.text.indexOf("]{", at);
  if (shut < 0) return undefined;
  const end = line.text.indexOf("}", shut + 2);
  if (end < 0) return undefined;
  return {
    from: byteIn(line, shut + 1),
    to: byteIn(line, end + 1),
    inside: line.text.slice(shut + 2, end),
  };
}

/** A run's bytes and its own text. */
interface Run {
  from: number;
  to: number;
  inside: string;
}

/** The `{...}` a line ends on, with the blanks before it, or nothing where a line ends on no run. */
function trailingRun(line: Line): Run | undefined {
  const said = line.text.trimEnd();
  if (!said.endsWith("}")) return undefined;
  const open = said.lastIndexOf("{");
  if (open <= 0) return undefined;
  let from = open;
  while (from > 0 && /\s/.test(said[from - 1] ?? "")) from -= 1;
  return { from: byteIn(line, from), to: byteIn(line, said.length), inside: said.slice(open + 1, -1) };
}

/** The heading level a row of `=` or `-` gives, or nothing for a row that is neither. */
function underline(said: string): 1 | 2 | undefined {
  if (said.length === 0) return undefined;
  if (/^=+$/.test(said)) return 1;
  // Fewer than three dashes underline a heading; three or more under
  // an attribute line are a scene break, which the engine settles.
  if (/^-+$/.test(said)) return 2;
  return undefined;
}

/**
 * The marks the engine settled, one answer per candidate in the order
 * they were asked about. A candidate the engine read no node at, or
 * read a node whose span does not cover the mark, is prose.
 */
function drawn(
  text: string,
  asked: readonly Candidate[],
  answers: readonly (NodeSource | undefined)[],
): Drawn[] {
  const found: Drawn[] = [];
  for (const [at, candidate] of asked.entries()) {
    const span = answers[at];
    if (span === undefined) continue;
    const mark = settled(text, candidate, span);
    if (mark !== undefined) found.push(mark);
  }
  return found;
}

/** One candidate, against the span the engine read at it. */
function settled(text: string, candidate: Candidate, span: NodeSource): Drawn | undefined {
  const { form, from, to } = candidate;
  const names = (): Names => namesOf(candidate.inside);
  switch (form) {
    // The node the line opens is the block under it, so its span
    // begins at the line and runs past it. A run the engine could not
    // read is a paragraph of its own, and its span is the line alone.
    // An attribute line's node is the block it names, so its span
    // reaches past the line's own newline. A line whose span stops
    // there is a code block, or a run with nothing under it to name.
    case "line":
      return span.start === from && span.end > to + 1
        ? { form, from, to, names: names(), level: undefined, open: undefined }
        : undefined;
    // A setext heading's span holds its text lines and its underline.
    case "setext": {
      if (span.start >= from || span.end < to) return undefined;
      const opens = headingAt(text, span.start, from);
      return opens === undefined
        ? undefined
        : { form, from, to, names: undefined, level: candidate.level, open: opens };
    }
    // An image's span ends after its run, so a run the engine read is
    // inside it and a run it did not read is outside.
    case "image":
      return span.start <= from && span.end >= to
        ? { form, from, to, names: names(), level: undefined, open: undefined }
        : undefined;
    // A heading covers its whole line, so a run it read is the
    // heading's own bytes rather than a node written inside it.
    case "heading":
      return span.start <= candidate.byte && span.end >= to && span.start < from
        ? { form, from, to, names: names(), level: undefined, open: undefined }
        : undefined;
    // A break's node is the command and the newline after it. A
    // command on the last line of a note has no newline to cover, so
    // its span ends where the command does.
    case "pagebreak":
    case "columnbreak":
      return span.start === from && span.end >= to
        ? { form, from, to, names: undefined, level: undefined, open: undefined }
        : undefined;
    // A span run's node is the bracketed text and the run together.
    case "span":
      return span.start === candidate.open && span.end === to
        ? { form, from, to, names: names(), level: undefined, open: candidate.open }
        : undefined;
  }
}

/**
 * The byte a setext heading's own text opens at, past an attribute
 * line naming it. Nothing where the text is that line alone: a row of
 * dashes under an attribute run is a scene break the run names, and
 * the engine reads it as one.
 */
function headingAt(text: string, from: number, under: number): number | undefined {
  const said = text.slice(offsetOf(text, from), offsetOf(text, under));
  const [first = ""] = said.split("\n");
  const named = first.trim().startsWith("{") && first.trim().endsWith("}");
  if (!named) return said.trim() === "" ? undefined : from;
  const rest = said.slice(first.length + 1);
  return rest.trim() === ""
    ? undefined
    : from + new TextEncoder().encode(first + "\n").length;
}

/** Every line of a note, as bytes of it. */
function linesOf(text: string): Line[] {
  const found: Line[] = [];
  const encoder = new TextEncoder();
  let at = 0;
  for (const said of text.split("\n")) {
    const width = encoder.encode(said).length;
    found.push({ from: at, to: at + width, text: said });
    at += width + 1;
  }
  return found;
}


test("orca and the engine read the same marks in every note of the fixture", async () => {
  for (const name of FIXTURE) {
    const text = await readFile(path.join(root, "fixture", name), "utf8");
    assert.deepEqual(orcaMarks(text), await engineMarks(name, text), name);
  }
});

test("orca and the engine agree on the forms the fixture chapter is written in", async () => {
  const name = "Chapter Fifteen.md";
  const text = await readFile(path.join(root, "fixture", name), "utf8");

  const read = orcaMarks(text);

  assert.deepEqual(read, await engineMarks(name, text));
  assert.deepEqual(
    read.map(([form]) => form),
    [
      "line",
      "setext",
      "heading",
      "pagebreak",
      "setext",
      "span",
      "line",
      "columnbreak",
      "image",
    ],
  );
});

test("orca and the engine agree on the shapes that are not marks", async () => {
  const text = [
    // An element answers to one name, so a second id is no run.
    "{#one #two}",
    "",
    "A paragraph.",
    "",
    "![[device.png]]{not a run}",
    "",
    // The image moves under the paragraph, and the run is that
    // paragraph's own text.
    "Look ![[device.png]]{.plate} beside.",
    "",
    "[bare] {.spaced}",
    "",
  ].join("\n");

  assert.deepEqual(orcaMarks(text), await engineMarks("shapes.md", text));
});

test("orca and the engine agree on a run written beside a bracket and a heading", async () => {
  const text = "# [Chapter One]{.number} The Road {#road .title}\n";

  assert.deepEqual(orcaMarks(text), await engineMarks("heading.md", text));
});

test("every mark orca reads covers characters of the note it was read from", async () => {
  const text = await readFile(path.join(root, "fixture", "Chapter Fifteen.md"), "utf8");

  const read = marksIn(text);

  assert.ok(read.length > 0);
  for (const mark of read) {
    assert.ok(mark.from < mark.to, "a mark covers characters");
    assert.ok(mark.to <= text.length, "a mark ends inside the note");
    assert.ok(mark.open === undefined || mark.open <= mark.from, "a mark opens at or before itself");
  }
});


test("orca and the engine agree on every shape written awkwardly", async () => {
  const written = [
    "{.one}\n\nA paragraph.\n",
    "  {.one}\n\nA paragraph.\n",
    "\t{.one}\n\nA paragraph.\n",
    "{}\n\nA paragraph.\n",
    "{ }\n\nA paragraph.\n",
    "{.1bad}\n\nA paragraph.\n",
    "{.one .two}\n{.three}\n\nA paragraph.\n",
    "> {.one}\n>\n> A quote.\n",
    "- {.one}\n- An item.\n",
    "# One {#a}\n## Two {.b}\n",
    "###### Six {.b}\n",
    "Title\n=====\n\nA paragraph.\n",
    "{.one}\n-\n\nA paragraph.\n",
    "One\nTwo\n---\n",
    "![A plate](plate.png){.full}\n",
    "![A plate](plate.png) {.full}\n",
    "Text ![A plate](plate.png){.full}\n",
    "[one]{.a}[two]{.b}\n",
    "[one][two]{.a}\n",
    "[one](two){.a}\n",
    "`[one]{.a}`\n",
    "    [one]{.a}\n",
    "```\n[one]{.a}\n```\n",
    "---\ntitle: One\n---\n{.one}\n\nA paragraph.\n",
    "| a | b |\n| - | - |\n| [one]{.a} | 2 |\n",
    "A paragraph with {.one} inside.\n",
    "{.one} at the head of a paragraph.\n",
    "A paragraph.\n\n\\pagebreak\n\nAnother.\n",
    "A paragraph.\n\n\\columnbreak\n\nAnother.\n",
    "A paragraph.\n\n\\pagebreak",
    "A paragraph.\n\n    \\pagebreak\n",
    "A paragraph \\pagebreak and more.\n",
    "\\pagebreak\n\nA paragraph.\n",
  ];

  const apart: string[] = [];
  for (const text of written) {
    const read = orcaMarks(text);
    const engine = await engineMarks("awkward.md", text);
    if (JSON.stringify(read) !== JSON.stringify(engine)) {
      apart.push(`${JSON.stringify(text)} orca=${JSON.stringify(read)} engine=${JSON.stringify(engine)}`);
    }
  }
  assert.deepEqual(apart, []);
});


test("a run on a line the engine reads as prose is prose", () => {
  // `#` with no blank after it opens no heading, so the line is a
  // paragraph and the run is the text of it.
  assert.deepEqual(covers("#NotAHeading {.b}\n"), []);
});

test("a brace run over a row of equals opens a heading rather than naming a break", () => {
  // Only a row of dashes is a scene break, so this stays the setext
  // heading CommonMark reads.
  assert.deepEqual(covers("{.one}\n=====\n\nA paragraph.\n"), ['setext "====="']);
});

test("a run on the line below an image is a block of its own", () => {
  assert.deepEqual(covers("![A plate](plate.png)\n{.full}\n"), []);
});

test("a heading's words leave out the run fleuron reads and keep one it rejects", () => {
  assert.equal(headingWords("The Entail {.plain #entail}"), "The Entail");
  assert.equal(headingWords("Plain words"), "Plain words");
  assert.equal(headingWords("Odd {.1bad}"), "Odd {.1bad}");
});

// What this file does not cover: a break command indented under four
// spaces, or written inside a blockquote or a list item, which
// fleuron reads as a break and orca leaves as the text it was written
// as. Three shapes the oracle cannot judge are pinned above as orca's
// own behavior instead, because a span alone does not tell a heading
// from a paragraph that opens with a hash.
// The attributes of a setext heading whose whole text is one brace
// run take no chip, and neither does a second run held above a block
// the first one already named.
