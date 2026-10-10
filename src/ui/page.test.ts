import assert from "node:assert/strict";
import { test } from "node:test";
import { paintPage, sheetOf, type Page } from "fleuron";
import {
  fits,
  gapOf,
  nextPage,
  previousPage,
  seated,
  showPages,
  spanAt,
  turnedTo,
  type Leaf,
  type Marked,
  type Surface,
} from "@/ui/page";

/** A sheet as the fake press builds it. */
interface Sheet {
  attributes: Record<string, string>;
  markup: string | undefined;
}

const press = (
  attributes: Record<string, string>,
  markup: string | undefined,
): Sheet => ({ attributes, markup });

interface Fake extends Surface<Sheet> {
  readonly writes: Sheet[][];
  readonly trim: Record<string, string>;
  readonly asked: string[];
  readonly marked: { selector: string; name: string; value: string }[];
}

function surface(glyphs = 2): Fake {
  const writes: Sheet[][] = [];
  const trim: Record<string, string> = {};
  const asked: string[] = [];
  const marked: { selector: string; name: string; value: string }[] = [];
  return {
    writes,
    trim,
    asked,
    marked,
    dataset: {},
    style: {
      setProperty(name: string, value: string): void {
        trim[name] = value;
      },
    },
    querySelectorAll(selector: string): Iterable<Marked> {
      asked.push(selector);
      return Array.from(
        { length: glyphs },
        (): Marked => ({
          setAttribute(name, value): void {
            marked.push({ selector, name, value });
          },
        }),
      );
    },
    replaceChildren(...sheets: Sheet[]): void {
      writes.push(sheets);
    },
  };
}

const stages = { style: 1, lines: 1, flow: 1, paint: 1 };

function leaf(page: number, side: "recto" | "verso"): Leaf {
  return { markup: `<svg viewBox="0 0 432 648"></svg>`, page, folio: page, side };
}

test("a view shows the span it is on: one page, a spread, or a screenful", () => {
  assert.deepEqual(spanAt("single", 11, 6), { at: 11, count: 1 });
  // The book's first page is a recto, so it faces nothing.
  assert.deepEqual(spanAt("spread", 0, 6), { at: 0, count: 1 });
  assert.deepEqual(spanAt("spread", 1, 6), { at: 1, count: 2 });
  assert.deepEqual(spanAt("spread", 2, 6), { at: 1, count: 2 });
  assert.deepEqual(spanAt("spread", 3, 6), { at: 3, count: 2 });
  assert.deepEqual(spanAt("grid", 7, 6), { at: 6, count: 6 });
  assert.deepEqual(spanAt("grid", 12, 6), { at: 12, count: 6 });
});

test("each view turns by what it shows, and lands on a span rather than inside one", () => {
  const book = { pages: 337, screenful: 6 };

  const single = { mode: "single", at: 11, ...book } as const;
  assert.equal(nextPage(single), 12);
  assert.equal(previousPage(single), 10);

  // A spread turns two, except off the book's lone first page.
  const spread = { mode: "spread", at: 1, ...book } as const;
  assert.equal(nextPage(spread), 3);
  assert.equal(previousPage(spread), 0);
  assert.equal(nextPage({ ...spread, at: 0 }), 1);
  assert.equal(nextPage({ ...spread, at: 3 }), 5);

  // A grid turns the screenful it is showing.
  const grid = { mode: "grid", at: 6, ...book } as const;
  assert.equal(nextPage(grid), 12);
  assert.equal(previousPage(grid), 0);
});

test("page up, page down, home and end turn to the span each one names", () => {
  const grid = { mode: "grid", at: 6, pages: 337, screenful: 6 } as const;

  assert.equal(turnedTo("PageDown", grid), 12);
  assert.equal(turnedTo("PageUp", grid), 0);
  assert.equal(turnedTo("Home", grid), 0);
  // The last screenful of a 337-page book opens on page 337.
  assert.equal(turnedTo("End", grid), 336);
  assert.equal(turnedTo("ArrowDown", grid), undefined);

  const spread = { mode: "spread", at: 1, pages: 337, screenful: 6 } as const;
  // 337 is a recto, so the last spread is 336 and 337.
  assert.equal(turnedTo("End", spread), 335);
});

test("a spread seats a verso left and a recto right, so mirrored margins meet at the spine", () => {
  const pair = [leaf(2, "verso"), leaf(3, "recto")];
  assert.deepEqual(seated("spread", pair), pair);

  // The book opens on a recto, which leaves the slot beside it empty
  // rather than sliding the page onto the wrong side of the spine.
  const opening = seated("spread", [leaf(1, "recto")]);
  assert.deepEqual(opening, [undefined, leaf(1, "recto")]);

  // A verso closing the book is already on its own side.
  assert.deepEqual(seated("spread", [leaf(4, "verso")]), [leaf(4, "verso")]);
  // No other view has a spine to mirror across.
  assert.deepEqual(seated("grid", [leaf(1, "recto")]), [leaf(1, "recto")]);
});

test("a grid fits as many sheets as the well has room for", () => {
  const trim = { width: 432, height: 648 };

  assert.deepEqual(fits({ width: 600, height: 900 }, trim), {
    columns: 4,
    rows: 4,
  });
  // A well too small for one tile still shows a page.
  assert.deepEqual(fits({ width: 40, height: 40 }, trim), {
    columns: 1,
    rows: 1,
  });
});

test("a phone's grid is two sheets across and a tablet's is six", () => {
  const trim = { width: 432, height: 648 };

  assert.deepEqual(fits({ width: 362, height: 560 }, trim, "phone"), {
    columns: 2,
    rows: 2,
  });
  assert.deepEqual(fits({ width: 1140, height: 560 }, trim, "tablet"), {
    columns: 6,
    rows: 2,
  });
  // The desktop fits more sheets in the same well, at its own tile.
  assert.equal(fits({ width: 1140, height: 560 }, trim).columns, 8);
  assert.equal(gapOf("grid", "phone"), 14);
  assert.equal(gapOf("grid", "tablet"), 18);
  assert.equal(gapOf("grid"), 12);
  assert.equal(gapOf("spread", "phone"), gapOf("spread"));
});

test("a view's pages are the painter's markup in one write, not a node at a time", () => {
  const node = surface();

  showPages(
    node,
    {
      mode: "spread",
      leaves: [leaf(2, "verso"), leaf(3, "recto")],
      generation: 1,
      stages,
      pages: 337,
      note: "",
      columns: 2,
      rows: 1,
    },
    press,
  );

  assert.equal(node.writes.length, 1);
  const pages = (node.writes[0] ?? []).map((s) => s.attributes["data-page"]);
  assert.deepEqual(pages, ["2", "3"]);
  assert.equal(node.writes[0]?.[0]?.markup, leaf(2, "verso").markup);
});

test("a spread's empty seat is a sheet with no markup, hidden from what reads aloud", () => {
  const node = surface();

  showPages(
    node,
    {
      mode: "spread",
      leaves: [leaf(1, "recto")],
      generation: 1,
      stages,
      pages: 337,
      note: "",
      columns: 2,
      rows: 1,
    },
    press,
  );

  assert.deepEqual(node.writes[0]?.[0], {
    attributes: { "data-empty": "true", "aria-hidden": "true" },
    markup: undefined,
  });
});

test("the surface has the generation painted into it, what that cost, and the span it is showing", () => {
  const node = surface();

  showPages(
    node,
    {
      mode: "grid",
      leaves: [leaf(12, "verso"), leaf(13, "recto"), leaf(14, "verso")],
      generation: 7,
      stages: { style: 1, lines: 4, flow: 3, paint: 2 },
      pages: 337,
      note: "Chapter Twelve.md",
      columns: 3,
      rows: 1,
    },
    press,
  );

  assert.equal(node.dataset["generation"], "7");
  assert.equal(node.dataset["stageStyle"], "1");
  assert.equal(node.dataset["stageLines"], "4");
  assert.equal(node.dataset["stageFlow"], "3");
  assert.equal(node.dataset["stagePaint"], "2");
  assert.equal(node.dataset["view"], "grid");
  assert.equal(node.dataset["first"], "12");
  assert.equal(node.dataset["count"], "3");
  assert.equal(node.dataset["pages"], "337");
  assert.equal(node.dataset["note"], "Chapter Twelve.md");
});

test("the sheet box is the trim the painter drew, placed on the view's own grid", () => {
  const node = surface();

  showPages(
    node,
    {
      mode: "grid",
      leaves: [leaf(1, "recto")],
      generation: 1,
      stages,
      pages: 337,
      note: "",
      columns: 4,
      rows: 3,
    },
    press,
  );

  assert.equal(node.trim["--orca-trim-w"], "432");
  assert.equal(node.trim["--orca-trim-h"], "648");
  assert.equal(node.trim["--orca-columns"], "4");
  assert.equal(node.trim["--orca-rows"], "3");
  assert.equal(node.trim["--orca-gap"], "12px");
});

/** A 432 by 648 page whose sheet reaches 33 points past the trim. */
const BLED: Page = {
  number: 1,
  side: "recto",
  width: 432,
  height: 648,
  bleed: 9,
  slug: 24,
  sections: [],
  links: [],
  items: [],
};

function shown(markup: string): Fake {
  const node = surface();
  showPages(
    node,
    {
      mode: "single",
      leaves: [{ markup, page: 1, folio: 1, side: "recto" }],
      generation: 1,
      stages,
      pages: 1,
      note: "",
      columns: 1,
      rows: 1,
    },
    press,
  );
  return node;
}

test("a sheet that starts left of the trim and above it sizes the box", () => {
  const node = shown(`<svg viewBox="-33 -33 498 714"></svg>`);

  assert.equal(node.trim["--orca-trim-w"], "498");
  assert.equal(node.trim["--orca-trim-h"], "714");
});

test("a bled page is painted on its whole sheet, with the trim's edge drawn", () => {
  const markup = paintPage(BLED, { fonts: [] });
  const sheet = sheetOf(BLED);

  assert.deepEqual(sheet, { x: -33, y: -33, width: 498, height: 714 });
  assert.match(markup, /viewBox="-33 -33 498 714"/);
  assert.match(markup, /<rect[^>]*data-trim/);

  // The box takes the sheet, and the grid is fitted to it.
  const node = shown(markup);
  assert.equal(node.trim["--orca-trim-w"], "498");
  assert.equal(node.trim["--orca-trim-h"], "714");

  const plain = paintPage({ ...BLED, bleed: 0, slug: 0 }, { fonts: [] });
  assert.match(plain, /viewBox="0 0 432 648"/);
  assert.doesNotMatch(plain, /data-trim/);
});

test("a page is named for what reads it aloud, and the drawn glyphs are left out of it", () => {
  const node = surface();

  showPages(
    node,
    {
      mode: "single",
      leaves: [leaf(146, "verso")],
      generation: 1,
      stages,
      pages: 337,
      note: "",
      columns: 1,
      rows: 1,
    },
    press,
  );

  const named = node.writes[0]?.[0]?.attributes;
  assert.equal(named?.["role"], "group");
  assert.equal(named?.["aria-label"], "Page 146");
  // The glyph layer is the shaped text; the painter's selection layer
  // is the manuscript's own, and that is the one left to be read.
  assert.deepEqual(node.asked, ["text:not([data-selection-line])"]);
  assert.equal(node.marked.length, 2);
  for (const mark of node.marked) {
    assert.equal(mark.name, "aria-hidden");
    assert.equal(mark.value, "true");
  }
});

// What this tier does not cover: the surface inside a leaf, which the
// e2e job paints and photographs, and a spread of a real verso and the
// recto facing it, which waits on the preview reading a book longer
// than the sample note.
// A bled page here has no art on it, so this tier does not check that
// art reaching the bleed is painted there. The e2e job sets a bleed in
// the panel and reads the sheet off the painted page.
