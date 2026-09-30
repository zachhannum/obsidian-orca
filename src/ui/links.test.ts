import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Client, createEngine, styleOp, type Link, type Page, type PageBox } from "fleuron";
import { directoryVault } from "@/assets/directory";
import { Registry } from "@/assets/registry";
import { readText, type VaultAdapter } from "@/assets/vault";
import { pathLinks } from "@/book/links";
import { readModel } from "@/book/model";
import { sectionIds } from "@/book/names";
import { resolve } from "@/book/order";
import { sendBook } from "@/book/plan";
import { designSheets } from "@/style/sheet";
import { followAt } from "@/ui/links";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const vault = directoryVault(path.join(root, "fixture"));

/** The book note in the fixture vault. */
const BOOK = "Pride and Prejudice.md";

/** The chapter the acknowledgements link into, and the heading they name. */
const CHAPTER = "Chapter Fifteen";
const HEADING = "The Entail";

/** The url the acknowledgements link out to. */
const URL = "https://www.gutenberg.org/ebooks/1342";

function box(x: number, y: number, width: number, height = 14): PageBox {
  return { page: 3, x, y, width, height };
}

function page(links: Link[]): Page {
  return {
    number: 4,
    side: "recto",
    width: 396,
    height: 612,
    sections: [],
    items: [],
    links,
  };
}

/** The middle of an area, where a click lands on it. */
function middle(area: PageBox): [number, number] {
  return [area.x + area.width / 2, area.y + area.height / 2];
}

test("a link broken across two lines follows from both lines and from nowhere between them", () => {
  const first = box(300, 96, 80);
  const second = box(54, 116, 70);
  const set = page([
    { areas: [first, second], to: { kind: "place", node: 185, place: box(54, 231, 336) } },
  ]);
  const turn = { kind: "turn", page: 3 };

  assert.deepEqual(followAt(set, ...middle(first)), turn);
  assert.deepEqual(followAt(set, ...middle(second)), turn);
  // The gap under the first line, and the rest of the first line.
  assert.equal(followAt(set, 60, 112), undefined);
  assert.equal(followAt(set, 100, 100), undefined);
});

test("a link to a website opens its url and turns no page", () => {
  const area = box(232, 112, 48);
  const set = page([{ areas: [area], to: { kind: "uri", url: URL } }]);

  assert.deepEqual(followAt(set, ...middle(area)), { kind: "open", url: URL });
});

/** Every file in a vault, the way Obsidian sees one. */
async function under(from: VaultAdapter, folder = "/"): Promise<string[]> {
  const { files, folders } = await from.list(folder);
  const inside = await Promise.all(folders.map((at) => under(from, at)));
  return [...files, ...inside.flat()];
}

/** The fixture book set on the pinned engine, over the sheets orca generates for it. */
async function fixturePages(): Promise<Page[]> {
  const model = readModel(await readText(vault, BOOK));
  const links = pathLinks(await under(vault));
  const registry = new Registry(vault);
  const { ops } = await sendBook(
    model.book,
    model.order,
    links,
    BOOK,
    "",
    (at) => readText(vault, at),
    (at) => registry.take(at),
  );
  const { sections } = resolve(model.order, links, BOOK);
  const { title, author, publisher } = model.book.metadata;
  const sheets = designSheets(model.book.design, {
    sections: sectionIds(sections),
    title,
    author,
    publisher,
  });
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
    const output = await client.preview([...ops, styleOp(sheets)]);
    assert.ok(output, "the render was overtaken");
    return output.pages;
  } finally {
    engine.free();
  }
}

/**
 * The place in the book of the first page past `after` that sets these
 * words. The contents names each chapter too, so a chapter is looked
 * for past it.
 */
function placeOf(pages: Page[], words: string, after = -1): number {
  const at = pages.findIndex(
    (one, index) =>
      index > after && one.items.some((item) => item.kind === "text" && item.text === words),
  );
  assert.notEqual(at, -1, `no page sets ${words}`);
  return at;
}

test("a chapter entry in the contents, and the page number it prints, turn to where that chapter opens", async () => {
  const pages = await fixturePages();
  const listed = placeOf(pages, "Contents");
  const contents = pages[listed];
  assert.ok(contents);
  const opens = placeOf(pages, CHAPTER, listed);

  const entries = contents.links.filter(
    (link) => link.to.kind === "place" && link.to.place.page === opens,
  );
  // The entry's words, and the folio link with no words of its own.
  assert.equal(entries.length, 2);
  const [label, folio] = entries.map((link) => link.areas[0]);
  assert.ok(label && folio);
  assert.ok(folio.x > label.x + label.width, "the page number sits right of the entry");

  assert.deepEqual(followAt(contents, ...middle(label)), { kind: "turn", page: opens });
  assert.deepEqual(followAt(contents, ...middle(folio)), { kind: "turn", page: opens });
});

test("a link to a heading in another note turns to the page of that heading, and one to a website opens it", async () => {
  const pages = await fixturePages();
  const listed = placeOf(pages, "Contents");
  const thanks = pages[placeOf(pages, "Acknowledgements", listed)];
  assert.ok(thanks);
  const heading = placeOf(pages, HEADING, listed);

  const [inside, outside] = thanks.links;
  assert.ok(inside && outside);
  // The link to the heading wraps, and each line of it follows.
  assert.equal(inside.areas.length, 2);
  for (const area of inside.areas) {
    assert.deepEqual(followAt(thanks, ...middle(area)), { kind: "turn", page: heading });
  }
  const [area] = outside.areas;
  assert.ok(area);
  assert.deepEqual(followAt(thanks, ...middle(area)), { kind: "open", url: URL });
});

// What this tier does not cover: the click itself, the cursor over a
// link, inspect mode taking the click, the linked manuscript following
// the turn, and copy over a link, which the e2e specs cover. A url
// opened outside Obsidian is seen only as far as the call that opens it.
