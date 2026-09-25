import type { Book, LinkMark } from "./harness/book";
import { expect, test } from "./harness/test";

/** The generated contents, as the toolbar names it. */
const CONTENTS = "Contents";

/** The chapter a contents entry is clicked for, the page it opens on, and its note. */
const CHAPTER = "Chapter Fifteen";
const OPENS = 15;
const CHAPTER_NOTE = "Chapter Fifteen.md";

/** The note the manuscript is split from. */
const FIRST_NOTE = "Chapter Twelve.md";

/** The section whose note links to a heading and to a website, and the page it is set on. */
const THANKS = "Acknowledgements";
const THANKS_PAGE = 19;

/** The heading the acknowledgements link to, and the url they link out to. */
const HEADING = "The Entail";
const URL = "https://www.gutenberg.org/ebooks/1342";

/** The three views, by the label on the switcher and the mode it paints. */
const VIEWS = [
  ["Single page", "single"],
  ["Spread", "spread"],
  ["Grid", "grid"],
] as const;

declare global {
  interface Window {
    /** The urls a spec caught `window.open` being handed, and the one it stood in for. */
    orcaOpened?: { urls: string[]; open: typeof window.open } | undefined;
  }
}

/** The mark of a contents entry, and of the page number printed beside it. */
async function entryOf(book: Book, chapter: string): Promise<[LinkMark, LinkMark]> {
  const marks = await book.links();
  const label = marks.find((mark) => mark.line.includes(chapter));
  const folio = marks.find((mark) => label !== undefined && mark.link === label.link + 1);
  if (label === undefined || folio === undefined) throw new Error(`no entry for ${chapter}`);
  return [label, folio];
}

/** The marks of each link on one page, by the link's index there. */
async function linksOn(book: Book, page: number): Promise<LinkMark[][]> {
  const byLink: LinkMark[][] = [];
  for (const mark of await book.links()) {
    if (mark.page === page) (byLink[mark.link] ??= []).push(mark);
  }
  return byLink;
}

test("a click on a contents entry turns the book to the page that chapter opens on", async ({
  book,
}) => {
  await book.open();
  await book.painted();
  await book.choose(CONTENTS);
  await expect(book.chapterName).toHaveText(CONTENTS);

  const [label] = await entryOf(book, CHAPTER);
  await book.click(label);

  await expect(book.surface).toHaveAttribute("data-first", String(OPENS));
  await expect(book.chapterName).toHaveText(CHAPTER);
});

test("a click on the page number an entry prints turns the book the same way", async ({
  book,
}) => {
  await book.open();
  await book.painted();
  await book.choose(CONTENTS);
  await expect(book.chapterName).toHaveText(CONTENTS);

  const [, folio] = await entryOf(book, CHAPTER);
  await book.click(folio);

  await expect(book.surface).toHaveAttribute("data-first", String(OPENS));
});

test("the pointer over a link shows the link cursor, and nowhere else", async ({
  book,
  obsidian,
}) => {
  await book.open();
  await book.painted();
  await book.choose(CONTENTS);
  await expect(book.chapterName).toHaveText(CONTENTS);

  const [label] = await entryOf(book, CHAPTER);
  await obsidian.page.mouse.move(label.x, label.y);
  await expect(book.surface).toHaveClass(/is-on-link/);
  const sheet = await book.seat(0).boundingBox();
  if (sheet === null) throw new Error("no sheet on screen");
  await obsidian.page.mouse.move(sheet.x + 4, sheet.y + 4);
  await expect(book.surface).not.toHaveClass(/is-on-link/);
});

for (const [label, mode] of VIEWS) {
  test(`a link to a heading in another note turns the book to that heading, in ${mode}`, async ({
    book,
  }) => {
    await book.open();
    await book.painted();
    await book.show(label, mode);
    await book.choose(THANKS);
    await expect(book.chapterName).toHaveText(THANKS);

    const [heading] = await linksOn(book, THANKS_PAGE);
    const line = heading?.at(-1);
    // The link is broken across two lines, and this is its second.
    expect(heading).toHaveLength(2);
    if (line === undefined) throw new Error("no link to the heading");
    await book.click(line);

    // A grid names the chapter its screenful opens with, which can be
    // one before the heading.
    if (mode !== "grid") await expect(book.chapterName).toHaveText(CHAPTER);
    await expect.poll(async () => book.words()).toContain(HEADING);
  });
}

test("a linked manuscript follows the turn a link makes", async ({ book, manuscript }) => {
  await manuscript.open(FIRST_NOTE);
  await book.split();
  await book.painted();
  await book.choose(CONTENTS);
  await expect(book.chapterName).toHaveText(CONTENTS);

  const [label] = await entryOf(book, CHAPTER);
  await book.click(label);

  await expect(book.surface).toHaveAttribute("data-first", String(OPENS));
  await expect.poll(async () => manuscript.showing()).toEqual([CHAPTER_NOTE]);
});

test("a click on a link to a website opens its url outside Obsidian and turns no page", async ({
  book,
  obsidian,
}) => {
  await book.open();
  await book.painted();
  await book.choose(THANKS);
  await expect(book.chapterName).toHaveText(THANKS);

  // A url the window opens goes to the system's browser, which this
  // suite cannot see, so the call that hands it over is caught instead.
  await obsidian.page.evaluate(() => {
    const caught = { urls: [] as string[], open: window.open };
    window.orcaOpened = caught;
    window.open = (url) => {
      caught.urls.push(String(url));
      return null;
    };
  });
  try {
    const [, website] = await linksOn(book, THANKS_PAGE);
    const line = website?.[0];
    if (line === undefined) throw new Error("no link to a website");
    await book.click(line);

    await expect
      .poll(async () => obsidian.page.evaluate(() => window.orcaOpened?.urls ?? []))
      .toEqual([URL]);
    await expect(book.surface).toHaveAttribute("data-first", String(THANKS_PAGE));
  } finally {
    await obsidian.page.evaluate(() => {
      if (window.orcaOpened !== undefined) window.open = window.orcaOpened.open;
      window.orcaOpened = undefined;
    });
  }
});

test("with inspect mode on, a click on a link pins its box and turns no page", async ({
  book,
  inspect,
}) => {
  await book.open();
  await book.painted();
  await book.choose(CONTENTS);
  await expect(book.chapterName).toHaveText(CONTENTS);
  const contents = await book.reading();
  await inspect.on();

  const [label] = await entryOf(book, CHAPTER);
  await inspect.pinAt(label);

  await expect(book.surface).toHaveAttribute("data-first", String(contents));
  await inspect.off();
});

test("copy over a link returns the words of the lines the drag covered", async ({
  book,
  obsidian,
}) => {
  await book.open();
  await book.painted();
  await book.choose(THANKS);
  await expect(book.chapterName).toHaveText(THANKS);

  const copied = await obsidian.page.evaluate(() => {
    const surface = document.querySelector("[data-testid='orca-sheets']");
    const lines = [...(surface?.querySelectorAll("text[data-selection-line]") ?? [])];
    const first = lines[0]?.firstChild;
    const last = lines.at(-1);
    if (!first || !last?.firstChild) return null;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last.firstChild, (last.textContent ?? "").length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const event = new ClipboardEvent("copy", {
      bubbles: true,
      clipboardData: new DataTransfer(),
    });
    surface?.dispatchEvent(event);
    const text = event.clipboardData?.getData("text/plain") ?? null;
    selection?.removeAllRanges();
    return { text, set: lines.map((line) => line.textContent).join("\n") };
  });

  // The link marks sit over the selection layer and take no pointer,
  // so what a drag over a link copies is the layer's own words.
  expect(copied?.text).toBe(copied?.set);
  expect(copied?.text).toContain("first edition");
});

// What this suite does not cover: the url reaching the system's
// browser, since the spec catches the call that hands it over. A drag
// that ends on a link, which follows nothing because the selection it
// made is not empty, is not driven with a real mouse.
