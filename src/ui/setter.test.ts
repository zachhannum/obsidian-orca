import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import type { LayoutOutput, Op, Page } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel } from "@/book/model";
import type { EngineClient, FaceSet, Range, Stages } from "@/engine/session";
import { Setter, type Progress, type Setting } from "@/ui/setter";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

const BOOK = "Pride and Prejudice.md";

/** The pages each section of the fake book is laid out to. */
const SPREAD = 2;

/**
 * A book of two pages per source, each page naming the id of the
 * section it came from. Ids run in document order and are not
 * consecutive, which is what a real run gives.
 */
class FakeClient implements EngineClient {
  readonly rendered: Op[][] = [];
  readonly ranges: Range[] = [];
  current = 0;
  stages: Stages = { style: 0, lines: 0, flow: 0, paint: 0 };
  private sources = 0;

  preview(ops: Op[] = [], range?: Range): Promise<LayoutOutput | null> {
    if (ops.length > 0) {
      this.rendered.push(ops);
      this.current += 1;
      for (const op of ops) {
        if (op.op === "book") this.sources = op.sources.length;
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
    return Promise.resolve(new Uint8Array());
  }

  fontBytes(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  private pages(): Page[] {
    return Array.from({ length: this.sources * SPREAD }, (_, at) => ({
      number: at + 1,
      side: at % 2 === 0 ? ("recto" as const) : ("verso" as const),
      width: 432,
      height: 648,
      sections: [Math.floor(at / SPREAD) * 10 + 5],
      items: [],
    }));
  }
}

function faces(): FaceSet {
  return { add: () => Promise.resolve() };
}

async function setting(client: EngineClient): Promise<Setting> {
  const paths = (await vault.list("/")).files;
  return {
    model: async (at) => readModel(await readText(vault, at)),
    read: (at) => readText(vault, at),
    name: (at) => path.basename(at, ".md"),
    links: pathLinks(paths),
    client: Promise.resolve(client),
    faces: faces(),
  };
}

test("a book is set from its reading order, and every section keeps its folios", async () => {
  const client = new FakeClient();
  const setter = new Setter(await setting(client));

  const laid = await setter.open(BOOK);

  assert.equal(laid.name, "Pride and Prejudice");
  assert.equal(laid.sections.length, 8);
  // The fixture names a chapter the vault does not have, so the book
  // is set without it and it has no folios of its own.
  assert.deepEqual(laid.ranges.get(5), { first: 11, last: 12 });
  assert.equal(laid.ranges.get(6), undefined);
  assert.deepEqual(laid.ranges.get(7), { first: 13, last: 14 });
  // The whole book comes back once, because a section's id says where
  // it falls only against every other id in the book.
  assert.deepEqual(client.ranges.at(-1), { first: 0, count: 14 });
});

test("a book being set reports the sections it has read and the entry it opens at", async () => {
  const client = new FakeClient();
  const setter = new Setter(await setting(client));
  const told: Progress[] = [];

  await setter.open(BOOK, {
    note: "Chapter Twelve.md",
    told: (at) => told.push(at),
  });

  const first = told[0];
  const last = told.at(-1);
  assert.ok(first && last);
  assert.equal(first.name, "Pride and Prejudice");
  assert.equal(first.of, 7);
  // A generated section is written rather than read, so it is done
  // before the first note is opened.
  assert.equal(first.read, 2);
  assert.equal(last.read, 7);
  assert.equal(last.opening, "Chapter Twelve");
});

test("a book already set is handed back rather than laid out again", async () => {
  const client = new FakeClient();
  const setter = new Setter(await setting(client));

  const laid = await setter.open(BOOK);
  assert.equal(await setter.open(BOOK), laid);
  assert.equal(client.rendered.length, 1);

  setter.forget(BOOK);
  assert.notEqual(await setter.open(BOOK), laid);
  assert.equal(client.rendered.length, 2);
});

// What this tier does not cover: the engine's own pagination, so the
// folios here are the fake client's. The e2e suite is where a real
// chapter opens on the page the real run put it on.
