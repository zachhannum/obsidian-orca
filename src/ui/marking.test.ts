import assert from "node:assert/strict";
import { test } from "node:test";
import type { NodeSource } from "fleuron";
import { Marks, type Read, type Shelved } from "@/ui/marking";

const BOOK = "Book.md";
const NOTE = "Chapter One.md";
const OTHER = "Chapter Two.md";

/** A note whose one attribute line the fake engine reads. */
const TEXT = ["{.epigraph}", "> A quote.", ""].join("\n");

/** The span the fake engine reads the attribute line into: the line and the quote under it. */
const SPAN: NodeSource = { source: NOTE, start: 0, end: TEXT.length - 1 };

/** A book on the engine, as much of one as drawing a note needs. */
class Book implements Read {
  dropped = false;
  /** Every note the engine holds, by its path. */
  readonly held = new Map<string, string>();
  /** The bytes each ask was made at, in the order they were asked. */
  readonly asked: number[] = [];
  private readonly watchers = new Set<() => void>();

  constructor(notes: Record<string, string> = { [NOTE]: TEXT }) {
    for (const [note, text] of Object.entries(notes)) this.held.set(note, text);
  }

  textOf(note: string): string | undefined {
    return this.held.get(note);
  }

  readonly session = {
    nodeAt: (_note: string, byte: number): Promise<number | undefined> => {
      this.asked.push(byte);
      return Promise.resolve(byte === 0 ? 1 : undefined);
    },
    sourceOf: (node: number): Promise<NodeSource | undefined> =>
      Promise.resolve(node === 1 ? SPAN : undefined),
  };

  watch(painted: () => void): () => void {
    this.watchers.add(painted);
    return () => {
      this.watchers.delete(painted);
    };
  }

  /** The book rendered, which is what tells every note drawn from it. */
  paint(): void {
    for (const painted of [...this.watchers]) painted();
  }

  /** The number of notes waiting to be told this book painted. */
  get watched(): number {
    return this.watchers.size;
  }
}

/** A shelf of one book, and the calls the marks made on it. */
class Shelf implements Shelved {
  readonly opened: string[] = [];
  readonly typed: { book: string; note: string; text: string }[] = [];
  readonly redraws: string[] = [];
  /** The books this shelf refuses to set, by path. */
  readonly refuses = new Set<string>();
  /** The book each path is set as now, which a drop replaces. */
  readonly books = new Map<string, Book>();
  /** Every note that belongs to a book, by its path. */
  readonly notes = new Map<string, string>([
    [NOTE, BOOK],
    [OTHER, BOOK],
  ]);

  constructor(book = new Book({ [NOTE]: TEXT, [OTHER]: TEXT })) {
    this.books.set(BOOK, book);
  }

  member(note: string): string | undefined {
    return this.notes.get(note);
  }

  open(book: string): Promise<Read> {
    this.opened.push(book);
    if (this.refuses.has(book)) return Promise.reject(new Error("it will not set"));
    const held = this.books.get(book);
    if (held === undefined) return Promise.reject(new Error("no such book"));
    return Promise.resolve(held);
  }

  retype(book: string, note: string, text: string): void {
    this.typed.push({ book, note, text });
    this.books.get(book)?.held.set(note, text);
  }

  redrawn(book: string): void {
    this.redraws.push(book);
  }
}

test("a note of a book sets that book, and two notes of one book set it once", async () => {
  const shelf = new Shelf();
  const marks = new Marks(shelf);

  const one = await marks.marksIn(NOTE, TEXT);
  const two = await marks.marksIn(OTHER, TEXT);

  assert.equal(one?.marks.length, 1);
  assert.equal(two?.marks.length, 1);
  assert.deepEqual(shelf.opened, [BOOK, BOOK], "each note asked for its book");
  assert.equal(shelf.books.get(BOOK)?.watched, 1, "the book is watched once");
});

test("a note no book lists asks nothing, sets nothing and draws nothing", async () => {
  const shelf = new Shelf();
  const marks = new Marks(shelf);

  assert.equal(await marks.marksIn("Loose.md", TEXT), undefined);

  assert.deepEqual(shelf.opened, []);
  assert.deepEqual(shelf.typed, []);
});

test("an ask the engine has older text for sends that text, and the render draws it", async () => {
  const shelf = new Shelf();
  const marks = new Marks(shelf);
  const book = shelf.books.get(BOOK);
  assert.ok(book);
  const edited = TEXT.replace(".epigraph", ".verse");
  let told = 0;
  marks.watch(NOTE, () => {
    told += 1;
  });

  // The engine holds the text before the edit, so the ask answers
  // nothing and the edited text is sent.
  assert.equal(await marks.marksIn(NOTE, edited), undefined);
  assert.deepEqual(shelf.typed, [{ book: BOOK, note: NOTE, text: edited }]);
  assert.equal(told, 0);

  book.paint();

  assert.equal(told, 1, "the editor was told the parse moved on");
  const settled = await marks.marksIn(NOTE, edited);
  assert.deepEqual(settled?.marks[0]?.names?.classes, ["verse"]);
});

test("a book set again after it was dropped is watched again", async () => {
  const shelf = new Shelf();
  const marks = new Marks(shelf);
  const first = shelf.books.get(BOOK);
  assert.ok(first);
  await marks.marksIn(NOTE, TEXT);

  // The ceiling stopped the book, and the next ask sets a second one.
  const second = new Book({ [NOTE]: TEXT });
  shelf.books.set(BOOK, second);
  marks.clear();
  await marks.marksIn(NOTE, TEXT);

  assert.equal(first.watched, 0, "the watch on the stopped book was dropped");
  assert.equal(second.watched, 1);
  let told = 0;
  marks.watch(NOTE, () => {
    told += 1;
  });
  second.paint();
  assert.equal(told, 1);
});

test("a book that will not set is asked for once, and again after the shelf is read again", async () => {
  const shelf = new Shelf();
  shelf.refuses.add(BOOK);
  const marks = new Marks(shelf);

  assert.equal(await marks.marksIn(NOTE, TEXT), undefined);
  assert.equal(await marks.marksIn(NOTE, TEXT), undefined);
  assert.deepEqual(shelf.opened, [BOOK], "a refusing book was set again");

  shelf.refuses.delete(BOOK);
  marks.clear();

  assert.notEqual(await marks.marksIn(NOTE, TEXT), undefined);
});

test("a render of one book draws its own notes again, and says which book painted", async () => {
  const shelf = new Shelf();
  const marks = new Marks(shelf);
  const book = shelf.books.get(BOOK);
  assert.ok(book);
  await marks.marksIn(NOTE, TEXT);
  assert.notEqual(marks.marksNow(NOTE, TEXT), undefined);

  book.paint();

  assert.equal(marks.marksNow(NOTE, TEXT), undefined, "the parse it drew from stood");
  assert.deepEqual(shelf.redraws, [BOOK]);
});

test("a note already settled is answered without asking the engine again", async () => {
  const shelf = new Shelf();
  const marks = new Marks(shelf);
  const book = shelf.books.get(BOOK);
  assert.ok(book);

  await marks.marksIn(NOTE, TEXT);
  const asks = book.asked.length;
  await marks.marksIn(NOTE, TEXT);

  assert.equal(book.asked.length, asks);
  assert.deepEqual(shelf.opened, [BOOK]);
});

// What this tier does not cover: the engine's own parse, so the spans
// here are the fake book's and only the plumbing around them is proven.
// Which marks a real note takes lives in the runs tests, and the e2e
// suite is where a chapter of the fixture draws its chips with no
// preview open and redraws them after an id is edited. The hold a pane
// takes on a book is the plugin's, so the grace and the ceiling under
// an open chapter are proven in the pool tests and in the e2e suite.
