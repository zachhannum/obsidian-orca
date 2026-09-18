import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Folios,
  Inspection,
  LayoutOutput,
  NodeSource,
  Op,
  Page,
} from "fleuron";
import { EngineError } from "@/engine/errors";
import { pdfTarget } from "@/engine/export";
import {
  Session,
  type EngineClient,
  type FaceSet,
  type Stages,
} from "@/engine/session";

/** A client that counts what it is sent and hands back set PDF bytes. */
class FakeClient implements EngineClient {
  readonly rendered: Op[][] = [];
  current = 0;
  stages: Stages = { style: 0, lines: 0, flow: 0, paint: 0 };

  constructor(
    private readonly book: number,
    private readonly exported: () => Promise<Uint8Array | null>,
  ) {}

  preview(ops: Op[] = []): Promise<LayoutOutput | null> {
    if (ops.length > 0) {
      this.rendered.push(ops);
      this.current += 1;
      this.stages = {
        style: this.stages.style + 1,
        lines: this.stages.lines + 1,
        flow: this.stages.flow + 1,
        paint: this.stages.paint + 1,
      };
    }
    return Promise.resolve({
      pages: leaves(this.book),
      first: 0,
      bookPages: this.book,
      fonts: [],
      assets: [],
      warnings: [],
    });
  }

  exportPdf(ops: Op[] = []): Promise<Uint8Array | null> {
    if (ops.length > 0) this.rendered.push(ops);
    return this.exported();
  }

  fontBytes(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  nodeAt(): Promise<number | null> {
    return Promise.resolve(null);
  }

  sourceOf(): Promise<NodeSource | null> {
    return Promise.resolve(null);
  }

  foliosOf(nodes: number[]): Promise<(Folios | null)[]> {
    return Promise.resolve(nodes.map(() => null));
  }

  inspect(): Promise<Inspection | null> {
    return Promise.resolve(null);
  }

  inspectMarginBox(): Promise<Inspection | null> {
    return Promise.resolve(null);
  }

  hit(): Promise<number | null> {
    return Promise.resolve(null);
  }
}

const faces: FaceSet = {
  add: () => Promise.resolve(undefined),
  remove: () => undefined,
};

/** A book of `count` empty pages. */
function leaves(count: number): Page[] {
  return Array.from({ length: count }, (_, at) => ({
    number: at + 1,
    side: at % 2 === 0 ? ("recto" as const) : ("verso" as const),
    width: 432,
    height: 648,
    sections: [],
    links: [],
    items: [],
  }));
}

/** One op, enough for the fake to count a render. */
const edit: Op[] = [{ op: "split", level: 0 }];

test("the PDF target exports from the session that drew the preview", async () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const client = new FakeClient(5, () => Promise.resolve(pdf));
  const session = new Session(client, faces);
  await session.open(edit);
  const stages = { ...session.stages };
  const generation = session.generation;
  const received: Uint8Array[] = [];

  const result = await pdfTarget.run(session, (bytes) => {
    received.push(bytes);
    return Promise.resolve();
  });

  assert.equal(client.rendered.length, 1);
  assert.deepEqual(session.stages, stages);
  assert.equal(session.generation, generation);
  assert.equal(received.length, 1);
  assert.equal(received[0], pdf);
  assert.deepEqual(result, { bytes: pdf.byteLength, leaves: 5 });
});

test("the PDF target names its format", () => {
  assert.equal(pdfTarget.id, "pdf");
  assert.equal(pdfTarget.label, "PDF");
  assert.equal(pdfTarget.extension, "pdf");
  assert.deepEqual(pdfTarget.options, {});
});

test("an export the engine answers with nothing throws and writes nothing", async () => {
  const client = new FakeClient(3, () => Promise.resolve(null));
  const session = new Session(client, faces);
  await session.open(edit);
  let sunk = 0;

  await assert.rejects(
    pdfTarget.run(session, () => {
      sunk += 1;
      return Promise.resolve();
    }),
    EngineError,
  );
  assert.equal(sunk, 0);
});

test("an export the engine fails routes its message and writes nothing", async () => {
  const client = new FakeClient(3, () =>
    Promise.reject(new Error("the book has no pages")),
  );
  const session = new Session(client, faces);
  await session.open(edit);
  let sunk = 0;

  await assert.rejects(
    pdfTarget.run(session, () => {
      sunk += 1;
      return Promise.resolve();
    }),
    (error: unknown) =>
      error instanceof EngineError && error.message === "the book has no pages",
  );
  assert.equal(sunk, 0);
});

// What this file does not cover: a real engine's stage counters across
// an export, and the bytes being a valid PDF. The Node tier's sample
// export and the e2e run's `qpdf --check` prove those. A sink that
// throws is the caller's to report, so its error passes through as it is.
