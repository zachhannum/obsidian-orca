import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import type { Folios, LayoutOutput, NodeSource, Op, Page, Sheet } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { VAULT_FONTS, familyNamed, type FontIndex } from "@/assets/fonts";
import { contentKey, fontUrl } from "@/assets/registry";
import { faceBytes } from "@/assets/sfnt";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel } from "@/book/model";
import { lineByte } from "@/book/place";
import type { Face } from "@/book/plan";
import type { Design, FontUse } from "@/style/design";
import { FACES_SHEET, OWN_SHEET } from "@/style/sheet";
import { pdfTarget } from "@/engine/export";
import type { Clock } from "@/engine/loop";
import type { Engines } from "@/engine/pool";
import type { EngineClient, FaceSet, Range, Stages } from "@/engine/session";
import {
  Composer,
  type Composing,
  type Progress,
  type Typeset,
} from "@/ui/composer";
import {
  readFontIndex,
  resolveUse,
  vaultFonts,
  type FontPlaces,
  type ResolvedUse,
} from "@/ui/fonts";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

const BOOK = "Pride and Prejudice.md";

/** The pages each section of the fake book is typeset to. */
const SPREAD = 2;

/**
 * A book of two pages per source, each page naming the id of the
 * section it came from. Ids run in document order and are not
 * consecutive, which is what a real run gives.
 */
class FakeClient implements EngineClient {
  readonly rendered: Op[][] = [];
  readonly ranges: Range[] = [];
  /** The sheets the last style op sent, which the engine styles every page with. */
  sheets: readonly Sheet[] = [];
  /** The sheets the engine held at each export. */
  readonly exported: (readonly Sheet[])[] = [];
  current = 0;
  stages: Stages = { style: 0, lines: 0, flow: 0, paint: 0 };
  /** The text of each source the book op sent, by the name it sent it under. */
  protected sent: { name: string; text: string }[] = [];

  private get sources(): number {
    return this.sent.length;
  }

  preview(ops: Op[] = [], range?: Range): Promise<LayoutOutput | null> {
    if (ops.length > 0) {
      this.rendered.push(ops);
      this.current += 1;
      for (const op of ops) {
        if (op.op === "book") {
          this.sent = op.sources.map(({ name, text }) => ({ name, text }));
        }
        if (op.op === "style") this.sheets = op.sheets;
      }
    }
    if (range !== undefined) this.ranges.push(range);
    const book = this.pages();
    const first = range?.first ?? 0;
    const count = range?.count ?? book.length;
    return Promise.resolve({
      pages: book.slice(first, first + count),
      first,
      bookPages: book.length,
      fonts: [],
      assets: [],
      warnings: [],
    });
  }

  exportPdf(): Promise<Uint8Array | null> {
    this.exported.push(this.sheets);
    return Promise.resolve(new Uint8Array());
  }

  fontBytes(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  /**
   * The section a byte falls in, as a real engine does: nothing for a
   * byte of the source's frontmatter, which was read into no node.
   */
  nodeAt(source: string, byte: number): Promise<number | null> {
    const at = this.sent.findIndex((sent) => sent.name === source);
    const text = this.sent[at]?.text;
    if (text === undefined) return Promise.resolve(null);
    const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(text)?.[0] ?? "";
    const written = new TextEncoder().encode(frontmatter).length;
    return Promise.resolve(byte < written ? null : at * 10 + 5);
  }

  /** The source a section id came from, the way `nodeAt` numbers them. */
  sourceOf(node: number): Promise<NodeSource | null> {
    const at = Math.floor(node / 10);
    const sent = this.sent[at];
    if (at * 10 + 5 !== node || sent === undefined) return Promise.resolve(null);
    return Promise.resolve({ source: sent.name, start: 0, end: 0 });
  }

  foliosOf(nodes: number[]): Promise<(Folios | null)[]> {
    return Promise.resolve(
      nodes.map((node) => {
        const at = Math.floor(node / 10);
        if (at * 10 + 5 !== node || at >= this.sources) return null;
        return {
          first: at * SPREAD + 1,
          last: at * SPREAD + SPREAD,
          at: at * SPREAD,
          count: SPREAD,
        };
      }),
    );
  }

  inspect(): Promise<null> {
    return Promise.resolve(null);
  }

  inspectMarginBox(): Promise<null> {
    return Promise.resolve(null);
  }

  hit(): Promise<null> {
    return Promise.resolve(null);
  }

  private pages(): Page[] {
    return Array.from({ length: this.sources * SPREAD }, (_, at) => ({
      number: at + 1,
      side: at % 2 === 0 ? ("recto" as const) : ("verso" as const),
      width: 432,
      height: 648,
      sections: [Math.floor(at / SPREAD) * 10 + 5],
      links: [],
      items: [],
    }));
  }
}

/** A pool that starts a client of its own each time a book is set. */
class Clients {
  readonly started: FakeClient[] = [];

  readonly engines: Engines = {
    client: () => {
      const client = new FakeClient();
      this.started.push(client);
      return Promise.resolve(client);
    },
    hold: () => () => undefined,
    retry: () => undefined,
  };
}

/** A client that holds its replies from the moment the test says so. */
class PausedClient extends FakeClient {
  private waiting: (() => void)[] | undefined;

  /** Holds every reply from here on. */
  hold(): void {
    this.waiting = [];
  }

  /** The replies paused so far. */
  get holding(): number {
    return this.waiting?.length ?? 0;
  }

  /** Lets every reply paused since then run. */
  release(): void {
    const paused = this.waiting ?? [];
    this.waiting = undefined;
    for (const resume of paused) resume();
  }

  override async preview(
    ops: Op[] = [],
    range?: Range,
  ): Promise<LayoutOutput | null> {
    const waiting = this.waiting;
    if (waiting !== undefined) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    return super.preview(ops, range);
  }
}

/** A clock the test steps itself, so nothing here waits on a real one. */
class Steps implements Clock {
  private waiting: (() => void)[] = [];

  after(_ms: number, fire: () => void): () => void {
    const at = this.waiting.length;
    this.waiting.push(fire);
    return () => {
      this.waiting[at] = () => undefined;
    };
  }

  /** Runs every wait that has come due and not been cancelled. */
  tick(): void {
    const due = this.waiting;
    this.waiting = [];
    for (const fire of due) fire();
  }
}

/** Lets the promises already settled run before the test looks again. */
function drain(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function faces(): FaceSet {
  return { add: () => Promise.resolve(undefined), remove: () => undefined };
}

/** Every file in the fixture vault, the way Obsidian sees one. */
async function paths(folder = "/"): Promise<string[]> {
  const { files, folders } = await vault.list(folder);
  const under = await Promise.all(folders.map((at) => paths(at)));
  return [...files, ...under.flat()];
}

async function setting(client: EngineClient): Promise<Composing> {
  const found = await paths();
  const links = pathLinks(found);
  return {
    model: async (at) => readModel(await readText(vault, at)),
    read: (at) => readText(vault, at),
    files: vault,
    name: (at) => path.basename(at, ".md"),
    fonts: () => Promise.resolve([]),
    links,
    engines: {
      client: () => Promise.resolve(client),
      hold: () => () => undefined,
      retry: () => undefined,
    },
    faces: faces(),
  };
}

test("a book is set from its reading order, and no page of it comes back to say where", async () => {
  const client = new FakeClient();
  const composer = new Composer(await setting(client));

  const book = await composer.open(BOOK);

  assert.equal(book.name, "Pride and Prejudice");
  assert.equal(book.sections.length, 9);
  // Setting the book asks for the window the first view paints, not
  // for every page of it to work out where the sections landed.
  assert.deepEqual(client.ranges, [{ first: 0, count: 2 }]);
});

test("a section says where it opens now, asked of the engine at the ask", async () => {
  const client = new FakeClient();
  const composer = new Composer(await setting(client));

  const book = await composer.open(BOOK);

  // Chapter Twelve is the sixth section sent, so it opens on the
  // eleventh page: the answer counts pages from 0.
  assert.equal(await book.opens(5), 10);
  // The fixture names a chapter the vault does not have, so nothing
  // crossed for it and it opens nowhere.
  assert.equal(await book.opens(6), undefined);
  assert.equal(await book.opens(7), 12);
  // Matter orca generated is asked about under the name it crossed as.
  assert.equal(await book.opens(0), 0);
});

test("a chapter opening on a block that set nothing opens under it", async () => {
  const client = new DroppedOpening();
  const composer = new Composer(await setting(client));

  const book = await composer.open(BOOK);

  // The chapter opens on an image the engine would not read, so its
  // first written byte is on no page. The lines under it are asked
  // about too, and the chapter opens where its content landed.
  assert.equal(await book.opens(5), 10);
  // A section the book did not set is still on no page at all.
  assert.equal(await book.opens(6), undefined);
});

test("a heading asks the engine where the line it opens on was set", async () => {
  const client = new Asked();
  const composer = new Composer(await setting(client));
  const book = await composer.open(BOOK);
  const text = client.written("Chapter Twelve.md");
  client.asked.length = 0;

  // Line 0 is the frontmatter, which is on no page.
  assert.deepEqual(await book.linesOpen(5, [0, 5]), [undefined, 10]);
  assert.deepEqual(client.asked, [
    { source: "Chapter Twelve.md", byte: lineByte(text, 0) },
    { source: "Chapter Twelve.md", byte: lineByte(text, 5) },
  ]);
  // A section with no note crossed has no line on any page.
  assert.deepEqual(await book.linesOpen(6, [3]), [undefined]);
});

/** A client that keeps every byte it was asked to place. */
class Asked extends FakeClient {
  readonly asked: { source: string; byte: number }[] = [];

  written(name: string): string {
    return this.sent.find((sent) => sent.name === name)?.text ?? "";
  }

  override nodeAt(source: string, byte: number): Promise<number | null> {
    this.asked.push({ source, byte });
    return super.nodeAt(source, byte);
  }
}

/**
 * A book whose every chapter opens on a block the engine set nothing
 * from: the first byte of a source was read into no node, and the
 * lines under it were.
 */
class DroppedOpening extends FakeClient {
  /** The first byte each source was asked about. */
  private readonly opening = new Map<string, number>();

  override nodeAt(source: string, byte: number): Promise<number | null> {
    const first = this.opening.get(source) ?? byte;
    this.opening.set(source, first);
    return first === byte ? Promise.resolve(null) : super.nodeAt(source, byte);
  }
}

test("a book being set reports the sections it has read and the entry it opens at", async () => {
  const client = new FakeClient();
  const composer = new Composer(await setting(client));
  const told: Progress[] = [];

  await composer.open(BOOK, {
    note: "Chapter Twelve.md",
    told: (at) => told.push(at),
  });

  const first = told[0];
  const last = told.at(-1);
  assert.ok(first && last);
  assert.equal(first.name, "Pride and Prejudice");
  assert.equal(first.of, 8);
  // A generated section is written rather than read, so it is done
  // before the first note is opened.
  assert.equal(first.read, 2);
  assert.equal(last.read, 8);
  assert.equal(last.opening, "Chapter Twelve");
});

test("a book already set is handed back rather than typeset again", async () => {
  const client = new FakeClient();
  const composer = new Composer(await setting(client));

  const book = await composer.open(BOOK);
  assert.equal(await composer.open(BOOK), book);
  assert.equal(client.rendered.length, 1);

  composer.forget(BOOK);
  assert.notEqual(await composer.open(BOOK), book);
  assert.equal(client.rendered.length, 2);
});

test("a burst of keystrokes leaves the pages last painted up until the render lands", async () => {
  const clock = new Steps();
  const client = new PausedClient();
  const composer = new Composer(await setting(client), clock);
  const book = await composer.open(BOOK);
  const renders = client.rendered.length;
  let painted = 0;
  book.watch(() => {
    painted += 1;
  });

  client.hold();
  for (const text of ["It i", "It is", "It is a"]) {
    composer.retype(BOOK, "Chapter Twelve.md", text);
  }
  await drain();
  clock.tick();
  await drain();

  // Three keystrokes, one render, and it has not answered yet: no view
  // has been told to repaint, so the pages already on screen are still
  // the last ones painted.
  assert.equal(client.holding, 1);
  assert.equal(painted, 0);

  client.release();
  await drain();

  assert.equal(client.rendered.length, renders + 1);
  assert.deepEqual(client.rendered.at(-1), [
    { op: "edit", name: "Chapter Twelve.md", text: "It is a" },
  ]);
  assert.equal(painted, 1);
});

test("the CSS the warnings are against moves with the render that repaints the preview", async () => {
  const clock = new Steps();
  const client = new PausedClient();
  const composer = new Composer(await setting(client), clock);
  const book = await composer.open(BOOK);
  const opened = book.css;
  const warned: string[] = [];
  book.watch(() => {
    warned.push(book.cssWarned);
  });

  client.hold();
  book.recss(`${opened}\np { position: absolute; }`);
  await drain();
  clock.tick();
  await drain();

  // The CSS crossed, but no render landed, so the warnings on hand are
  // still the ones against the CSS the book opened with.
  assert.equal(book.cssWarned, opened);
  assert.deepEqual(warned, []);

  client.release();
  await drain();

  assert.deepEqual(warned, [book.css]);
});

test("a chapter the engine already has the words of is no edit at all", async () => {
  const clock = new Steps();
  const client = new FakeClient();
  const composer = new Composer(await setting(client), clock);
  await composer.open(BOOK);
  const renders = client.rendered.length;

  // The note is written to disk after the keystrokes that made it, and
  // it arrives back as the text the engine was already sent.
  composer.retype(BOOK, "Chapter Twelve.md", await readText(vault, "Chapter Twelve.md"));
  await drain();
  clock.tick();
  await drain();

  assert.equal(client.rendered.length, renders);
});

test("an image a chapter picks up while it is drafted crosses on the next render", async () => {
  const clock = new Steps();
  const client = new FakeClient();
  const composer = new Composer(await setting(client), clock);
  const book = await composer.open(BOOK);
  const renders = client.rendered.length;
  const note = "Copyright.md";
  const copyright = await readText(vault, note);

  // The same file the acknowledgements embed, under a url of its own.
  composer.retype(BOOK, note, `${copyright}\n\n![[images/device.png]]\n`);
  await crossed(book, clock);

  // The words go first and the bytes follow, so the engine reads the
  // chapter and is then given the file it now names.
  const sent = client.rendered.slice(renders).flat();
  assert.deepEqual(sent.map((op) => op.op), ["edit", "image"]);
  const image = sent.find((op) => op.op === "image");
  assert.equal(image?.url, "images/device.png");
  assert.deepEqual(
    image?.bytes,
    new Uint8Array(await vault.readBinary("images/device.png")),
  );
  // One file has one set of pixels, whichever url draws it.
  assert.equal(
    book.assets.imageUrl("images/device.png"),
    book.assets.imageUrl("device.png"),
  );

  // A url the engine already holds crosses no second time.
  composer.retype(BOOK, note, `${copyright}\n\n![[images/device.png]]\n\n.`);
  await crossed(book, clock);
  assert.deepEqual(
    client.rendered.slice(renders).flat().map((op) => op.op),
    ["edit", "image", "edit"],
  );
});

test("CSS that names a new image sends the image before the style op that uses it", async () => {
  const clock = new Steps();
  const client = new FakeClient();
  const composer = new Composer(await setting(client), clock);
  const book = await composer.open(BOOK);
  const renders = client.rendered.length;
  const named = `${book.css}\n@page { background-image: url("images/device.png"); }`;

  book.recss(named);
  await crossed(book, clock);

  const sent = client.rendered.slice(renders).flat();
  assert.deepEqual(sent.map((op) => op.op), ["image", "style"]);
  const image = sent.find((op) => op.op === "image");
  assert.equal(image?.url, "images/device.png");
  assert.deepEqual(
    image?.bytes,
    new Uint8Array(await vault.readBinary("images/device.png")),
  );

  // A url the engine already holds crosses no second time.
  book.recss(`${named}\nh1 { background-image: url("images/device.png"); }`);
  await crossed(book, clock);
  assert.deepEqual(
    client.rendered.slice(renders).flat().map((op) => op.op),
    ["image", "style", "style"],
  );
});

/**
 * Waits out the reads an embed costs, then steps the loop the ops they
 * planned are waiting on. The book says when it has finished resolving,
 * so nothing here waits on a clock or on a count of turns.
 */
async function crossed(book: Typeset, clock: Steps): Promise<void> {
  // The composer reaches the book on a microtask, so the retype has to
  // land before the promise it started can be read.
  await drain();
  await book.resolving;
  clock.tick();
  await drain();
}

test("a book whose engine died is set again from what crossed, cuts and all", async () => {
  const clock = new Steps();
  const clients = new Clients();
  const cut: Face = { key: "spectral-regular", bytes: new Uint8Array([1, 2, 3]) };
  const composer = new Composer(
    {
      ...plain(await setting(new FakeClient())),
      engines: clients.engines,
      fonts: (uses) => Promise.resolve(uses.map((use) => resolvedOf(use, [cut]))),
    },
    clock,
  );

  const book = await composer.open(BOOK);
  book.restyle(refonted(book.design, "Spectral"), [
    resolvedOf({ font: "Spectral", variant: undefined }, [cut]),
  ]);
  await crossed(book, clock);
  // The keystroke is on this thread and nowhere else: the wait has not
  // run, so the engine that dies never saw it.
  composer.retype(BOOK, "Chapter Twelve.md", "# Chapter Twelve\n\nIt is a truth.\n");
  await drain();

  let told = 0;
  book.watch(() => {
    told += 1;
  });
  composer.died(BOOK);
  await drain();

  assert.equal(book.dropped, true);
  assert.equal(told, 1, "the views on a dead book are told to set it again");

  const said: Progress[] = [];
  const again = await composer.open(BOOK, {
    told: (at) => said.push(at),
  });
  assert.equal(clients.started.length, 2, "the book went onto a second engine");
  // The pane says what it is doing, and says it is doing it again.
  assert.deepEqual(
    said.map((at) => at.again),
    said.map(() => true),
  );
  assert.ok(said.length > 0);
  const opened = clients.started[1]?.rendered[0] ?? [];
  const sources = opened.find((op) => op.op === "book");
  assert.ok(sources?.op === "book");
  const chapter = sources.sources.find((source) => source.name === "Chapter Twelve.md");
  assert.match(chapter?.text ?? "", /It is a truth\./);
  // The face is registered for one session, and that session is gone,
  // so the cuts cross again ahead of the sheets that name them.
  assert.deepEqual(
    opened.filter((op) => op.op === "font").map((op) => [...op.bytes]),
    [[1, 2, 3]],
  );
  // The body is set in Spectral, and the fixture sets its scene break
  // in Junicode and its heads and folios in Alegreya.
  assert.deepEqual(again.fonts, ["Spectral", "Junicode", "Alegreya"]);
  const styled = opened.at(-1);
  assert.equal(styled?.op, "style");
});

/**
 * The fixture book with no font of its own. The fixture sets its drop
 * cap in a font, and a spec about the fonts a book asks for names them
 * itself.
 */
function plain(composing: Composing): Composing {
  return {
    ...composing,
    model: async (at) => {
      const model = await composing.model(at);
      if (model !== undefined) delete model.book.design.chapter.dropCapFont;
      return model;
    },
  };
}

/** The styles of each font the headed book names, by family. */
const CUTS: Record<string, Face[]> = {
  Alegreya: [{ key: "alegreya-regular", bytes: new Uint8Array([1]) }],
  Spectral: [{ key: "spectral-regular", bytes: new Uint8Array([2]) }],
};

/**
 * The fixture book with its body in one font, its first heading level
 * in another, and its second level in the body's font again. Every
 * font the book asks for is written down in `asked`.
 */
function headed(composing: Composing, asked: string[] = []): Composing {
  return {
    ...composing,
    model: async (at) => {
      const model = await composing.model(at);
      if (model !== undefined) {
        model.book.design.body.font = "Alegreya";
        model.book.design.headings[1].font = "Spectral";
        model.book.design.headings[2].font = "Alegreya";
      }
      return model;
    },
    fonts: (uses) => {
      asked.push(...uses.map((use) => use.font));
      return Promise.resolve(uses.map((use) => resolvedOf(use, CUTS[use.font] ?? [])));
    },
  };
}

/** The bytes of each face a run of ops sends, in order. */
function sentFaces(ops: readonly Op[]): number[][] {
  return ops.flatMap((op) => (op.op === "font" ? [[...op.bytes]] : []));
}

test("a book opens with the faces of every font its design names, each family once", async () => {
  const client = new FakeClient();
  const asked: string[] = [];
  const composer = new Composer(headed(await setting(client), asked));

  const book = await composer.open(BOOK);

  // The fixture's scene break is set in a face of its own, so the book
  // opens in three families.
  assert.deepEqual(asked, ["Alegreya", "Spectral", "Junicode"]);
  const opened = client.rendered[0] ?? [];
  assert.deepEqual(sentFaces(opened), [[1], [2]]);
  assert.equal(opened.at(-1)?.op, "style");
  assert.deepEqual(book.fonts, ["Alegreya", "Spectral", "Junicode"]);
});

test("a book set again on a new engine after its engine stops keeps its heading fonts", async () => {
  const clients = new Clients();
  const composer = new Composer(
    headed({ ...(await setting(new FakeClient())), engines: clients.engines }),
  );

  const first = await composer.open(BOOK);
  composer.discard(BOOK);
  await drain();
  assert.equal(first.dropped, true);

  await composer.open(BOOK);
  assert.equal(clients.started.length, 2, "the book went onto a second engine");
  assert.deepEqual(sentFaces(clients.started[1]?.rendered[0] ?? []), [[1], [2]]);
});

/** Asserts the sheets carry the book's own CSS and the faces of the headed book. */
function styledAsOpened(sheets: readonly Sheet[], book: Typeset): void {
  const own = sheets.find((sheet) => sheet.name === OWN_SHEET)?.css ?? "";
  assert.notEqual(own, "", "the fixture book has no CSS of its own");
  assert.equal(own, book.css);
  const faces = sheets.find((sheet) => sheet.name === FACES_SHEET)?.css ?? "";
  assert.match(faces, /Alegreya/);
  assert.match(faces, /Spectral/);
}

test("after the folios are read, the preview keeps the book's own CSS and its faces", async () => {
  const clock = new Steps();
  const client = new FakeClient();
  const composer = new Composer(headed(await setting(client)), clock);
  const book = await composer.open(BOOK);

  await (await composer.reading(BOOK)).ranges();
  composer.retype(BOOK, "Chapter Twelve.md", "# Chapter Twelve\n\nIt is a truth.\n");
  await drain();
  clock.tick();
  await drain();
  await book.session.read(0);

  // Only the open styled the book, so the sheets the pages are set
  // under are the ones it sent.
  assert.equal(client.rendered.flat().filter((op) => op.op === "style").length, 1);
  styledAsOpened(client.sheets, book);
});

test("after the folios are read, the export keeps the book's own CSS and its faces", async () => {
  const client = new FakeClient();
  const composer = new Composer(headed(await setting(client)));
  const book = await composer.reading(BOOK);

  await book.ranges();
  await pdfTarget.run(book.session, () => Promise.resolve());

  assert.equal(client.exported.length, 1);
  styledAsOpened(client.exported[0] ?? [], book);
});

test("the folios come from the book's one session, and reading them sends no op", async () => {
  const clients = new Clients();
  const composer = new Composer({
    ...(await setting(new FakeClient())),
    engines: clients.engines,
  });
  const book = await composer.open(BOOK);
  const client = clients.started[0];
  assert.ok(client);
  const renders = client.rendered.length;

  assert.equal(await composer.reading(BOOK), book);
  const ranges = await book.ranges();

  assert.equal(client.rendered.length, renders);
  assert.equal(clients.started.length, 1);
  // Chapter Twelve is the sixth section sent, two pages to a section.
  assert.deepEqual(ranges?.get(5), { first: 11, last: 12 });
  // The chapter the vault does not have lands on no page.
  assert.equal(ranges?.has(6), false);
});

test("a book whose notes changed tells its views, and the next read sets it once", async () => {
  const client = new FakeClient();
  const composer = new Composer(await setting(client));
  const book = await composer.open(BOOK);
  let told = 0;
  book.watch(() => {
    told += 1;
  });

  composer.forget(BOOK);
  await drain();

  assert.equal(book.dropped, true);
  assert.equal(told, 1, "a view left reading the book would set a second session");
  const [one, two] = await Promise.all([composer.reading(BOOK), composer.reading(BOOK)]);
  assert.equal(one, two);
  assert.notEqual(one, book);
  assert.equal(client.rendered.length, 2);
});

/** A font and variant resolved to faces, as the plugin's resolver hands them back. */
function resolvedOf(use: FontUse, faces: Face[]): ResolvedUse {
  return {
    use,
    registered: {
      font: use.font,
      variant: use.variant,
      family: use.font,
      faces: faces.map((face) => ({ url: face.url ?? face.key })),
    },
    faces,
    fellBack: false,
    unread: false,
  };
}

/** The fixture vault's own faces, and no platform directory. */
const PLACES: FontPlaces = {
  platform: vaultFonts(vault),
  vault: vaultFonts(vault),
  directories: [],
  folder: VAULT_FONTS,
};

/** The urls of the faces a run of ops sends. */
function sentUrls(ops: readonly Op[]): string[] {
  return ops.flatMap((op) => (op.op === "font" && op.url !== undefined ? [op.url] : []));
}

test("a book opens sending only the faces of the variants it uses", async () => {
  const index = await readFontIndex(PLACES);
  const junicode = familyNamed(index, "Junicode");
  assert.ok(junicode, "the fixture vault carries no Junicode");
  const urlsOf = (name: string): Promise<string[]> => {
    const variant = junicode.variants.find((each) => each.name === name);
    assert.ok(variant, `Junicode has no ${name}`);
    return Promise.all(
      variant.faces.map(async (face) => {
        const file = new Uint8Array(await vault.readBinary(face.path));
        return fontUrl(await contentKey(faceBytes(file, face.face)));
      }),
    );
  };
  const clock = new Steps();
  const client = new FakeClient();
  const base = plain(await setting(client));
  const composer = new Composer(
    {
      ...base,
      model: async (at) => {
        const model = await base.model(at);
        if (model !== undefined) model.book.design.body.font = "Junicode";
        return model;
      },
      fonts: (uses) => Promise.all(uses.map((use) => resolveUse(PLACES, index, use))),
    },
    clock,
  );

  const book = await composer.open(BOOK);

  const opened = client.rendered[0] ?? [];
  const regular = await urlsOf("Regular");
  assert.equal(regular.length, 3);
  // The fixture's heads and folios are set in Alegreya, so its face
  // crosses beside the body's.
  const heads = await defaultUrls(index, "Alegreya");
  assert.deepEqual(new Set(sentUrls(opened)), new Set([...regular, ...heads]));
  const faces = (sheets: readonly Op[]): string => {
    const style = sheets.filter((op) => op.op === "style").at(-1);
    assert.ok(style?.op === "style");
    return style.sheets.find((sheet) => sheet.name === FACES_SHEET)?.css ?? "";
  };
  assert.doesNotMatch(faces(opened), /Cond|Exp/);

  // A heading set in Cond sends Cond's faces alone, ahead of the style op.
  const design = structuredClone(book.design);
  design.headings[1] = { ...design.headings[1], font: "Junicode", fontVariant: "Cond" };
  const uses: FontUse[] = [
    { font: "Junicode", variant: undefined },
    { font: "Junicode", variant: "Cond" },
  ];
  book.restyle(design, await Promise.all(uses.map((use) => resolveUse(PLACES, index, use))));
  clock.tick();
  await drain();
  const restyled = client.rendered.at(-1) ?? [];
  assert.deepEqual(new Set(sentUrls(restyled)), new Set(await urlsOf("Cond")));
  assert.equal(restyled.at(-1)?.op, "style");
  assert.match(faces(restyled), /"Junicode Cond"/);
});

test("two font edits before the render still send the faces the first one planned", async () => {
  const clock = new Steps();
  const client = new FakeClient();
  const composer = new Composer(await setting(client), clock);
  const book = await composer.open(BOOK);
  const cut: Face = { key: "junicode-regular", bytes: new Uint8Array([7]), url: "orca-font:junicode-regular" };
  const junicode = resolvedOf({ font: "Junicode", variant: undefined }, [cut]);

  // The body and then a heading take the same font before the settle,
  // so both edits resolve to the same faces.
  const body = refonted(book.design, "Junicode");
  book.restyle(body, [junicode]);
  const headed = structuredClone(body);
  headed.headings[1] = { ...headed.headings[1], font: "Junicode" };
  book.restyle(headed, [junicode]);
  clock.tick();
  await drain();

  assert.deepEqual(sentUrls(client.rendered.at(-1) ?? []), ["orca-font:junicode-regular"]);
});

test("a book keeps the uses that loaded no face and the embeds that brought no bytes", async () => {
  const clock = new Steps();
  const client = new FakeClient();
  const composer = new Composer(plain(await setting(client)), clock);
  const book = await composer.open(BOOK);

  // The fixture's one embed resolves. Its design sets the scene break
  // in one font and the heads and folios in another, and this composer
  // registers no face for either, so both uses stand.
  const scene = { font: "Junicode", variant: undefined };
  const head = { font: "Alegreya", variant: undefined };
  assert.deepEqual(book.unread, []);
  assert.deepEqual(book.unloaded, [
    { use: scene, unread: false },
    { use: head, unread: false },
  ]);

  const note = "Copyright.md";
  const text = `${await readText(vault, note)}\n\n![[nowhere.png]]\n`;
  composer.retype(BOOK, note, text);
  await crossed(book, clock);
  const line = text.split("\n").indexOf("![[nowhere.png]]");
  assert.deepEqual(book.unread, [{ url: "nowhere.png", note, line }]);

  const use = { font: "Nowhere Sans", variant: undefined };
  book.restyle(refonted(book.design, use.font), [
    { use, registered: undefined, faces: [], fellBack: false, unread: true },
  ]);
  assert.deepEqual(book.unloaded, [
    { use, unread: true },
    { use: scene, unread: false },
    { use: head, unread: false },
  ]);

  // An embed taken back out of the note stops standing.
  composer.retype(BOOK, note, `${text}.`.replace("![[nowhere.png]]", ""));
  await crossed(book, clock);
  assert.deepEqual(book.unread, []);
});

/** The faces sheet of the last style op in a run of ops. */
function facesCss(ops: readonly Op[]): string {
  const style = ops.filter((op) => op.op === "style").at(-1);
  assert.ok(style?.op === "style");
  return style.sheets.find((sheet) => sheet.name === FACES_SHEET)?.css ?? "";
}

test("a font the book adds crosses as a face, and crosses again on a new engine", async () => {
  const index = await readFontIndex(PLACES);
  const urls = await defaultUrls(index, "Junicode");
  // The fixture's heads and folios are set in Alegreya, which crosses
  // beside the font the book adds.
  const heads = await defaultUrls(index, "Alegreya");
  const use: FontUse = { font: "Junicode", variant: undefined };

  const clock = new Steps();
  const clients = new Clients();
  const base = plain(await setting(new FakeClient()));
  const composer = new Composer(
    {
      ...base,
      engines: clients.engines,
      model: async (at) => {
        const model = await base.model(at);
        if (model !== undefined) {
          model.book.fonts = ["Junicode"];
          // The fixture sets its scene break in Junicode, and this test
          // is about a font no design key names.
          model.book.design.scene.font = undefined;
        }
        return model;
      },
      fonts: (uses) => Promise.all(uses.map((each) => resolveUse(PLACES, index, each))),
    },
    clock,
  );

  const book = await composer.open(BOOK);

  // No design key names the font, and its faces cross all the same.
  assert.deepEqual(book.fonts, ["Alegreya"]);
  assert.deepEqual(book.added, ["Junicode"]);
  assert.deepEqual(book.families, ["Alegreya", "Junicode"]);
  assert.deepEqual(book.unloaded, []);
  const opened = clients.started[0]?.rendered[0] ?? [];
  assert.deepEqual(new Set(sentUrls(opened)), new Set([...urls, ...heads]));
  assert.match(facesCss(opened), /font-family: "Junicode";/);

  // A face is registered for one session. The book set anew carries the
  // font it added, so the faces cross to the new engine too.
  composer.died(BOOK);
  await drain();
  const again = await composer.open(BOOK);
  assert.deepEqual(again.added, ["Junicode"]);
  assert.deepEqual(
    new Set(sentUrls(clients.started[1]?.rendered[0] ?? [])),
    new Set([...urls, ...heads]),
  );

  // A font taken back out drops out of the faces sheet.
  again.refont([], [await resolveUse(PLACES, index, use)]);
  clock.tick();
  await drain();
  assert.doesNotMatch(facesCss(clients.started[1]?.rendered.at(-1) ?? []), /Junicode/);
});

/** The urls the faces of one family's default variant cross as. */
async function defaultUrls(index: FontIndex, name: string): Promise<string[]> {
  const family = familyNamed(index, name);
  assert.ok(family, `the fixture vault carries no ${name}`);
  const variant = family.variants.find((each) => each.isDefault);
  assert.ok(variant, `${name} has no default variant`);
  return Promise.all(
    variant.faces.map(async (face) => {
      const file = new Uint8Array(await vault.readBinary(face.path));
      return fontUrl(await contentKey(faceBytes(file, face.face)));
    }),
  );
}

/** The design after a font pick, as the panel passes it to `restyle`. */
function refonted(design: Design, font: string): Design {
  return { ...design, body: { ...design.body, font } };
}

// What this tier does not cover: the engine's own pagination, so the
// folios here are the fake client's. The e2e suite is where a real
// chapter opens on the page the real run put it on, and where a reflow
// moves it. The book note page asking the composer for its folios lives
// inside Obsidian, so the e2e suite proves that wiring and the sheets
// the real engine keeps after it.
