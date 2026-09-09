import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Worker, type TransferListItem } from "node:worker_threads";
import {
  paintPage,
  styleOp,
  type LayoutOutput,
  type Folios,
  type NodeSource,
  type Op,
  type Page,
} from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { SAMPLE, openBook } from "@/book/sample";
import {
  startEngine,
  type WorkerHost,
  type WorkerPort,
} from "@/engine/bootstrap";
import { EngineError } from "@/engine/errors";
import { readModule } from "@/engine/module";
import { THEME_SHEET } from "@/style/theme";
import {
  Session,
  serialized,
  type EngineClient,
  type FaceSet,
  type Range,
  type Stages,
} from "@/engine/session";

const root = process.env["ORCA_ROOT"] ?? process.cwd();

class FakeClient implements EngineClient {
  readonly rendered: Op[][] = [];
  /** Every window asked for, in the order it was asked. */
  readonly ranges: Range[] = [];
  readonly asked: number[] = [];
  /** The node each byte of each source was read into, as a test sets them. */
  readonly nodes = new Map<string, number>();
  /** The place in a manuscript each node was read from. */
  readonly sources = new Map<number, NodeSource>();
  /** The pages each node's content is set on, as a test sets them. */
  readonly folios = new Map<number, Folios>();
  current = 0;
  stages: Stages = { style: 0, lines: 0, flow: 0, paint: 0 };
  private book: Page[];
  private overtaken: number | undefined;

  constructor(private readonly layout: LayoutOutput) {
    this.book = layout.pages;
  }

  /** The edit that leaves the book `pages` long. */
  rewrite(pages: number): void {
    this.book = leaves(pages);
    this.current += 1;
  }

  /**
   * The next render is overtaken: the engine applies its ops, a later
   * render lands on top, and the reply comes back as nothing at all.
   */
  overtake(pages: number): void {
    this.overtaken = pages;
  }

  preview(ops: Op[] = [], range?: Range): Promise<LayoutOutput | null> {
    // A range with nothing to apply is a question about the book as it
    // stands, so it raises no generation.
    if (ops.length > 0) {
      this.rendered.push(ops);
      this.current += 1;
      this.stages = { style: 1, lines: 1, flow: 1, paint: this.current };
      const overtaken = this.overtaken;
      this.overtaken = undefined;
      if (overtaken !== undefined) {
        this.rewrite(overtaken);
        return Promise.resolve(null);
      }
    }
    if (range !== undefined) this.ranges.push(range);
    const first = range?.first ?? 0;
    return Promise.resolve({
      ...this.layout,
      pages:
        range === undefined
          ? this.book
          : this.book.slice(first, first + range.count),
      first,
      bookPages: this.book.length,
    });
  }

  exportPdf(): Promise<Uint8Array | null> {
    return Promise.resolve(new Uint8Array());
  }

  fontBytes(font: number): Promise<Uint8Array> {
    this.asked.push(font);
    return Promise.resolve(new Uint8Array([font]));
  }

  nodeAt(source: string, byte: number): Promise<number | null> {
    return Promise.resolve(this.nodes.get(`${source}:${String(byte)}`) ?? null);
  }

  sourceOf(node: number): Promise<NodeSource | null> {
    return Promise.resolve(this.sources.get(node) ?? null);
  }

  foliosOf(nodes: number[]): Promise<(Folios | null)[]> {
    return Promise.resolve(nodes.map((node) => this.folios.get(node) ?? null));
  }
}

/** A client whose replies the test releases, one window at a time. */
class PausedClient extends FakeClient {
  private waiting: (() => void)[] = [];

  /** Lets every request paused so far run. */
  release(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const resume of waiting) resume();
  }

  override async preview(
    ops: Op[] = [],
    range?: Range,
  ): Promise<LayoutOutput | null> {
    // The reply is read off the book as it stands when the request
    // runs, not when it was sent, the same as the engine reads it.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    return super.preview(ops, range);
  }
}

function faces(): FaceSet & { readonly added: string[] } {
  const added: string[] = [];
  return {
    added,
    add: (family) => {
      added.push(family);
      return Promise.resolve();
    },
  };
}

/** A book of `count` pages, each saying which one it is. */
function leaves(count: number): Page[] {
  return Array.from({ length: count }, (_, at) => ({
    number: at + 1,
    side: at % 2 === 0 ? ("recto" as const) : ("verso" as const),
    width: 432,
    height: 648,
    sections: [],
    items: [
      {
        kind: "text" as const,
        x: 54,
        y: 73,
        fontId: 0,
        size: 18,
        text: `Page ${String(at + 1)}`,
        source: "",
        sourceMap: [],
        origin: null,
        features: { smallCaps: false },
        color: "#000000",
        glyphs: [],
      },
    ],
  }));
}

function typeset(pages = 1): LayoutOutput {
  return {
    pages: leaves(pages),
    first: 0,
    bookPages: pages,
    fonts: [
      {
        family: "eb garamond",
        name: "EB Garamond Regular",
        style: "Regular",
        attributes: { italic: false, weight: 400 },
        variations: [],
      },
    ],
    assets: [],
    warnings: [],
  };
}

test("a view opened again paints the pages the session already has", async () => {
  const client = new FakeClient(typeset());
  const session = new Session(client, faces());

  await session.open(openBook(SAMPLE));
  const first = await session.read(0);
  // The leaf closes and opens again, against the same session.
  await session.open(openBook(SAMPLE));

  assert.equal(client.rendered.length, 1);
  assert.equal((await session.read(0))?.pages[0], first?.pages[0]);
});

test("two leaves on one book lay it out once between them", async () => {
  const client = new FakeClient(typeset());
  const session = new Session(client, faces());

  await Promise.all([
    session.open(openBook(SAMPLE)),
    session.open(openBook(SAMPLE)),
  ]);

  assert.equal(client.rendered.length, 1);
});

test("opening asks for the first page and the one after it, not the book", async () => {
  const client = new FakeClient(typeset(337));
  const session = new Session(client, faces());

  await session.open(openBook(SAMPLE));

  assert.deepEqual(client.ranges, [{ first: 0, count: 2 }]);
  assert.equal(session.pages, 337);
});

test("a page rides in with the one either side, so the turn onto it waits on nothing", async () => {
  const client = new FakeClient(typeset(337));
  const session = new Session(client, faces());
  await session.open(openBook(SAMPLE));

  const first = await session.read(0);
  const second = await session.read(1);

  assert.equal(first?.pages[0]?.number, 1);
  // Page 2 came in with page 1, so the turn onto it asked for nothing
  // and page 3 is what rode along behind it.
  assert.equal(second?.pages[0]?.number, 2);
  assert.deepEqual(client.ranges, [
    { first: 0, count: 2 },
    { first: 2, count: 1 },
  ]);
});

test("a spread reads the two pages it paints, and asks for them as one range", async () => {
  const client = new FakeClient(typeset(337));
  const session = new Session(client, faces());
  await session.open(openBook(SAMPLE));

  const spread = await session.read(1, 2);

  assert.deepEqual(
    spread?.pages.map((page) => page.number),
    [2, 3],
  );
  // Pages 1 and 2 were already cached, so the range asks for the rest of
  // the spread and the neighbour behind it, not the book.
  assert.deepEqual(client.ranges, [
    { first: 0, count: 2 },
    { first: 2, count: 2 },
  ]);
});

test("a grid reads the screenful it paints, and nothing past its neighbours", async () => {
  const client = new FakeClient(typeset(337));
  const session = new Session(client, faces());
  await session.open(openBook(SAMPLE));

  const screenful = await session.read(0, 6);

  assert.deepEqual(
    screenful?.pages.map((page) => page.number),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(client.ranges, [
    { first: 0, count: 2 },
    { first: 2, count: 5 },
  ]);
});

test("a span running off the end of the book reads what the book has", async () => {
  const client = new FakeClient(typeset(3));
  const session = new Session(client, faces());
  await session.open(openBook(SAMPLE));

  const spread = await session.read(2, 2);

  assert.deepEqual(
    spread?.pages.map((page) => page.number),
    [3],
  );
});

test("a page already cached is painted from the cache rather than asked for again", async () => {
  const client = new FakeClient(typeset(337));
  const session = new Session(client, faces());
  await session.open(openBook(SAMPLE));
  await session.read(1);
  const asked = client.ranges.length;

  await session.read(0);

  assert.equal(client.ranges.length, asked);
});

test("an edit drops the pages from before it rather than painting one of them", async () => {
  const client = new FakeClient(typeset(337));
  const session = new Session(client, faces());
  await session.open(openBook(SAMPLE));
  await session.read(0);
  const asked = client.ranges.length;

  client.rewrite(337);
  const reading = await session.read(0);

  assert.ok(client.ranges.length > asked, "page 1 was painted from the book before the edit");
  assert.equal(reading?.pages[0]?.number, 1);
});

test("a render overtaken by a later one paints no page of the book it asked for", async () => {
  const client = new FakeClient(typeset(337));
  const session = new Session(client, faces());
  await session.open(openBook(SAMPLE));
  await session.read(0);
  const asked = client.ranges.length;

  client.overtake(12);
  await session.render([{ op: "edit", name: "chapter", text: "It is" }]);
  const reading = await session.read(0);

  // The reply came back behind the current generation, so it was
  // dropped: nothing of it was kept, and the page painted is asked for
  // again off the book the engine now has.
  assert.ok(client.ranges.length > asked, "a page from before the render was painted");
  assert.equal(reading?.length, 12);
  assert.equal(session.pages, 12);
});

test("a book that got shorter reads its last page rather than nothing", async () => {
  const client = new FakeClient(typeset(337));
  const session = new Session(client, faces());
  await session.open(openBook(SAMPLE));
  await session.read(336);

  client.rewrite(3);
  const reading = await session.read(336);

  assert.equal(reading?.at, 2);
  assert.equal(reading?.length, 3);
  assert.equal(reading?.pages[0]?.number, 3);
});

test("two turns onto one window ask for it once between them", async () => {
  const client = new PausedClient(typeset(337));
  const session = new Session(client, faces());
  const opened = session.open(openBook(SAMPLE));
  client.release();
  await opened;

  const both = Promise.all([session.read(4), session.read(4)]);
  await Promise.resolve();
  client.release();
  const [first, second] = await both;

  assert.equal(first?.pages[0]?.number, 5);
  assert.equal(second?.pages[0]?.number, 5);
  assert.deepEqual(client.ranges, [
    { first: 0, count: 2 },
    { first: 3, count: 3 },
  ]);
});

test("an edit that overtakes a window in flight is answered with the book it made", async () => {
  const client = new PausedClient(typeset(337));
  const session = new Session(client, faces());
  const opened = session.open(openBook(SAMPLE));
  client.release();
  await opened;

  const reading = session.read(120);
  await Promise.resolve();
  // The edit lands while the window is still out, so what comes back
  // is the book the edit made rather than the one before it.
  client.rewrite(200);
  client.release();
  await Promise.resolve();
  client.release();

  assert.equal((await reading)?.pages[0]?.number, 121);
  // Those pages are the edit's, so the turn back onto them is served
  // from the cache rather than fetched a second time.
  const asked = client.ranges.length;
  const again = session.read(120);
  await Promise.resolve();
  client.release();
  await again;
  assert.equal(client.ranges.length, asked);
});

test("the cache is the window, not every page read on the way to it", async () => {
  const client = new FakeClient(typeset(337));
  const session = new Session(client, faces());
  await session.open(openBook(SAMPLE));
  for (let at = 0; at < 12; at += 1) await session.read(at);
  const asked = client.ranges.length;

  // Page 1 was read past long ago, so it is asked for again.
  await session.read(0);

  assert.ok(client.ranges.length > asked, "the whole book was still cached");
});

test("the faces a run drew with come from the module, under the painter's names", async () => {
  const client = new FakeClient(typeset());
  const set = faces();

  await new Session(client, set).open(openBook(SAMPLE));

  assert.deepEqual(client.asked, [0]);
  assert.deepEqual(set.added, ["fleuron-face-0"]);
});

test("the cuts the engine registered come back indexed by the id it gave them", async () => {
  const layout = typeset();
  const registered = {
    family: "spectral",
    name: "Spectral Italic",
    style: "Italic",
    attributes: { italic: true, weight: 400 },
    variations: [{ tag: "wght", value: 400 }],
  };
  layout.fonts = [...layout.fonts, registered];
  const session = new Session(new FakeClient(layout), faces());

  // A session that has not opened a book has no faces.
  assert.deepEqual(session.faces, []);
  await session.open(openBook(SAMPLE));

  assert.deepEqual(session.faces, layout.fonts);
  assert.deepEqual(session.faces[1], registered);
});

test("a serialized client holds a second render back until the first answers", async () => {
  const order: string[] = [];
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;

  const client: EngineClient = {
    preview: async () => {
      calls += 1;
      const label = calls === 1 ? "a" : "b";
      order.push(`${label}:start`);
      if (label === "a") await gate;
      order.push(`${label}:end`);
      return typeset();
    },
    exportPdf: () => Promise.resolve(new Uint8Array()),
    fontBytes: () => Promise.resolve(new Uint8Array()),
    nodeAt: () => Promise.resolve(null),
    sourceOf: () => Promise.resolve(null),
    foliosOf: () => Promise.resolve([]),
    current: 0,
    stages: { style: 0, lines: 0, flow: 0, paint: 0 },
  };
  const wrapped = serialized(client);

  const a = wrapped.preview();
  const b = wrapped.preview();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ["a:start"]);

  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
});

test("a serialized client's queue moves on from a render that failed", async () => {
  let calls = 0;
  const client: EngineClient = {
    preview: () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("the engine refused it"))
        : Promise.resolve(typeset());
    },
    exportPdf: () => Promise.resolve(new Uint8Array()),
    fontBytes: () => Promise.resolve(new Uint8Array()),
    nodeAt: () => Promise.resolve(null),
    sourceOf: () => Promise.resolve(null),
    foliosOf: () => Promise.resolve([]),
    current: 0,
    stages: { style: 0, lines: 0, flow: 0, paint: 0 },
  };
  const wrapped = serialized(client);

  await assert.rejects(wrapped.preview());
  assert.ok(await wrapped.preview());
});

test("a serialized client reads current and stages live off the one it wraps", () => {
  const client = new FakeClient(typeset());
  const wrapped = serialized(client);

  assert.equal(wrapped.current, 0);
  client.current = 5;
  assert.equal(wrapped.current, 5);
  assert.equal(wrapped.stages, client.stages);
});

test("a cut off a variable file is painted at the place on its axes the run named", async () => {
  const layout = typeset();
  // One variable file carries several cuts, each of them a point on
  // its axes rather than a file of its own.
  layout.fonts = [
    {
      family: "alegreya",
      name: "Alegreya Medium",
      style: "Medium",
      attributes: { italic: false, weight: 500 },
      variations: [{ tag: "wght", value: 500 }],
    },
  ];
  const session = new Session(new FakeClient(layout), faces());

  await session.open(openBook(SAMPLE));
  const reading = await session.read(0);
  assert.ok(reading, "the book set to no pages");
  const page = reading.pages[0];
  assert.ok(page, "the reading carried no page");

  // The painter is given the run's font table. Without it every cut
  // draws at the file's default weight.
  const markup = paintPage(page, { fonts: reading.fonts });
  assert.match(markup, /font-variation-settings: &quot;wght&quot; 500/);
});

test("a book the engine refuses comes back as an engine error, not re-worded", async () => {
  const refusing: EngineClient = {
    preview: () => Promise.reject(new Error("unknown property `leadin`")),
    exportPdf: () => Promise.reject(new Error("unknown property `leadin`")),
    fontBytes: () => Promise.reject(new Error("no faces")),
    nodeAt: () => Promise.reject(new Error("no book")),
    sourceOf: () => Promise.reject(new Error("no book")),
    foliosOf: () => Promise.reject(new Error("no book")),
    current: 1,
    stages: { style: 0, lines: 0, flow: 0, paint: 0 },
  };

  await assert.rejects(
    new Session(refusing, faces()).open(openBook(SAMPLE)),
    (error: unknown) =>
      error instanceof EngineError &&
      error.message === "unknown property `leadin`",
  );
});

test("the sample note sets to a page the painter can draw", async () => {
  const engine = await startEngine(await moduleBytes(), nodeHost());
  try {
    const set = faces();
    const session = new Session(engine.client, set);

    await session.open(openBook(SAMPLE));

    assert.deepEqual(session.warnings, []);
    const reading = await session.read(0);
    assert.ok(reading, "the sample set to no pages");
    assert.equal(reading.at, 0);
    assert.equal(reading.length, session.pages);

    const page = reading.pages[0];
    assert.ok(page, "the sample set to no pages");
    const markup = paintPage(page, {
      fonts: reading.fonts,
      assets: reading.assets,
    });
    assert.match(markup, /^<svg /);
    assert.ok(markup.includes("Chapter Twelve"));
    assert.ok(set.added.length > 0, "no face came back from the module");
    assert.equal(session.generation, 1);
    assert.ok(session.stages.flow > 0);
  } finally {
    engine.stop();
  }
});

/** A sheet setting the book in the family the installed file carries. */
const TIMES = 'book { font-family: "Times New Roman", serif; }';

/** A face the machine has, for a test that registers a second family. */
const INSTALLED = "/System/Library/Fonts/Supplemental/Times New Roman.ttf";

test(
  "a second family registers at the tail of the faces, cut by cut",
  { skip: existsSync(INSTALLED) ? false : `no face at ${INSTALLED}` },
  async () => {
    const engine = await startEngine(await moduleBytes(), nodeHost());
    try {
      const session = new Session(engine.client, faces());
      await session.open(openBook(SAMPLE));
      const bundled = session.faces;

      // The whole registered table comes back, including the cuts the
      // page never drew with.
      assert.ok(bundled.length > 1, "the bundled family answered one cut");
      assert.deepEqual([...new Set(bundled.map((face) => face.family))], [
        "eb garamond",
      ]);
      const variable = bundled.filter((face) => face.variations.length > 0);
      assert.ok(variable.length > 0, "no cut of the variable file was pinned");
      assert.deepEqual(
        variable[0]?.variations.map((axis) => axis.tag),
        ["wght"],
      );

      await session.render([
        { op: "font", bytes: new Uint8Array(await readFile(INSTALLED)) },
        styleOp([{ name: THEME_SHEET, css: TIMES }]),
      ]);

      const added = session.faces.slice(bundled.length);
      assert.deepEqual(session.faces.slice(0, bundled.length), bundled);
      assert.deepEqual(added, [
        {
          family: "times new roman",
          name: "Times New Roman",
          style: "Regular",
          attributes: { italic: false, weight: 400 },
          variations: [],
        },
      ]);
    } finally {
      engine.stop();
    }
  },
);

test("a note in the fixture vault sets to PDF bytes, with no application around it", async () => {
  const vault = directoryVault(path.join(root, "fixture"));
  const engine = await startEngine(
    await readModule(directoryVault(engineDirectory()), "."),
    nodeHost(),
  );
  try {
    const name = "Chapter Twelve.md";
    const session = new Session(engine.client, faces());

    await session.open(openBook({ name, text: await readText(vault, name) }));
    const pdf = await session.pdf();

    // The pages the export was drawn from are the ones the session
    // already has.
    assert.ok(session.pages > 0);
    assert.equal(new TextDecoder().decode(pdf.subarray(0, 5)), "%PDF-");
    assert.ok(new TextDecoder().decode(pdf.subarray(-32)).includes("%%EOF"));
  } finally {
    engine.stop();
  }
});

/** The bundled worker, in a Node thread with `self` shimmed. */
function nodeHost(): WorkerHost {
  const shim = `
    import { parentPort, workerData } from "node:worker_threads";
    globalThis.self = {
      set onmessage(handler) {
        parentPort.on("message", (data) => handler({ data }));
      },
      postMessage: (message, transfer) =>
        parentPort.postMessage(message, transfer),
    };
    new Function(workerData.source)();
  `;
  return {
    url: (source) => source,
    release: () => {},
    start: (source) => {
      const worker = new Worker(shim, { eval: true, workerData: { source } });
      const port: WorkerPort = {
        onmessage: null,
        onerror: null,
        postMessage: (message, transfer) => {
          worker.postMessage(message, transfer as TransferListItem[]);
        },
        terminate: () => {
          void worker.terminate();
        },
      };
      worker.on("message", (data: unknown) => {
        port.onmessage?.(new MessageEvent("message", { data }));
      });
      return port;
    },
  };
}

async function moduleBytes(): Promise<ArrayBuffer> {
  const bytes = await readFile(path.join(engineDirectory(), "fleuron_bg.wasm"));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** The directory the pinned engine module is installed in. */
function engineDirectory(): string {
  const require = createRequire(import.meta.url);
  return path.dirname(require.resolve("fleuron/fleuron_bg.wasm"));
}

test("a byte answers with its node, a node with its place, and neither with nothing", async () => {
  const client = new FakeClient(typeset(2));
  client.nodes.set("Chapter Twelve.md:812", 412);
  client.sources.set(412, { source: "Chapter Twelve.md", start: 812, end: 1043 });
  const session = new Session(client, faces());

  assert.equal(await session.nodeAt("Chapter Twelve.md", 812), 412);
  assert.deepEqual(await session.sourceOf(412), {
    source: "Chapter Twelve.md",
    start: 812,
    end: 1043,
  });
  // A blank line between chapters, and matter the engine wrote itself.
  assert.equal(await session.nodeAt("Chapter Twelve.md", 0), undefined);
  assert.equal(await session.sourceOf(9), undefined);
});

test("several nodes answer with where each is set now, in the order asked about", async () => {
  const client = new FakeClient(typeset(2));
  client.folios.set(412, { first: 38, last: 52, at: 37, count: 15 });
  client.folios.set(90, { first: 3, last: 3, at: 2, count: 1 });
  const session = new Session(client, faces());

  // A node the book does not hold answers with nothing rather than
  // failing the call, so one stale id does not cost the rest.
  assert.deepEqual(await session.foliosOf([412, 7, 90]), [
    { first: 38, last: 52, at: 37, count: 15 },
    undefined,
    { first: 3, last: 3, at: 2, count: 1 },
  ]);
});

// What this tier does not cover: registering the view, and the page
// inside a leaf. Both wait on the e2e harness. It reads the PDF's header
// and trailer only; `qpdf --check` and a `pdftotext` round trip wait on
// the export flow. The window fetches run against a fake here, so what
// the engine does with a range it cannot fill is the e2e run's to prove,
// and so is which generation a real render comes back on.
