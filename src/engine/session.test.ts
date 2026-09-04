import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Worker, type TransferListItem } from "node:worker_threads";
import { paintPage, type LayoutOutput, type Op } from "fleuron";
import { SAMPLE, openBook } from "@/book/sample";
import {
  startEngine,
  type WorkerHost,
  type WorkerPort,
} from "@/engine/bootstrap";
import { EngineError } from "@/engine/errors";
import {
  Session,
  type EngineClient,
  type FaceSet,
  type Stages,
} from "@/engine/session";

class FakeClient implements EngineClient {
  readonly rendered: Op[][] = [];
  readonly asked: number[] = [];
  current = 0;
  stages: Stages = { style: 0, lines: 0, flow: 0, paint: 0 };

  constructor(private readonly layout: LayoutOutput) {}

  preview(ops: Op[] = []): Promise<LayoutOutput | null> {
    this.rendered.push(ops);
    this.current += 1;
    this.stages = { style: 1, lines: 1, flow: 1, paint: this.current };
    return Promise.resolve(this.layout);
  }

  fontBytes(font: number): Promise<Uint8Array> {
    this.asked.push(font);
    return Promise.resolve(new Uint8Array([font]));
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

function laidOut(): LayoutOutput {
  return {
    pages: [
      {
        number: 1,
        side: "recto",
        width: 432,
        height: 648,
        sections: [],
        items: [
          {
            kind: "text",
            x: 54,
            y: 73,
            fontId: 0,
            size: 18,
            text: "Chapter Twelve",
            glyphs: [],
          },
        ],
      },
    ],
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

test("a view opened again paints the pages the session already holds", async () => {
  const client = new FakeClient(laidOut());
  const session = new Session(client, faces());

  await session.open(openBook(SAMPLE));
  const first = session.output;
  // The leaf closes and opens again, against the same session.
  await session.open(openBook(SAMPLE));

  assert.equal(client.rendered.length, 1);
  assert.equal(session.output, first);
});

test("two leaves on one book lay it out once between them", async () => {
  const client = new FakeClient(laidOut());
  const session = new Session(client, faces());

  await Promise.all([
    session.open(openBook(SAMPLE)),
    session.open(openBook(SAMPLE)),
  ]);

  assert.equal(client.rendered.length, 1);
});

test("the faces a run drew with come from the module, under the painter's names", async () => {
  const client = new FakeClient(laidOut());
  const set = faces();

  await new Session(client, set).open(openBook(SAMPLE));

  assert.deepEqual(client.asked, [0]);
  assert.deepEqual(set.added, ["fleuron-face-0"]);
});

test("a book the engine refuses comes back as an engine error, not re-worded", async () => {
  const refusing: EngineClient = {
    preview: () => Promise.reject(new Error("unknown property `leadin`")),
    fontBytes: () => Promise.reject(new Error("no faces")),
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

    const output = session.output;
    assert.ok(output, "nothing came back from the engine");
    assert.deepEqual(output.warnings, []);
    const page = output.pages[0];
    assert.ok(page, "the sample set to no pages");

    const markup = paintPage(page, {
      fonts: output.fonts,
      assets: output.assets,
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
  const require = createRequire(import.meta.url);
  const bytes = await readFile(require.resolve("fleuron/fleuron_bg.wasm"));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

// What this tier does not reach: registering the view, and the page
// inside a leaf. Both wait on the e2e harness.
