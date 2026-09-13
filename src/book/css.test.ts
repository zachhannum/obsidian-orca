import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { readText } from "@/assets/vault";
import { bookCss, withCss } from "@/book/css";
import { readModel, withOrder } from "@/book/model";
import { entries, readOrder, writeOrder } from "@/book/order";

const BOOK = "Pride and Prejudice.md";

async function fixture(): Promise<string> {
  const vault = directoryVault(path.join(process.cwd(), "fixture"));
  return readText(vault, BOOK);
}

test("the fixture's css fence is read as the book's own CSS", async () => {
  const { order } = readModel(await fixture());
  assert.equal(
    bookCss(order),
    ".chapter-opening h1 {\n  letter-spacing: 0.02em;\n}",
  );
});

test("the CSS written back into its own fence leaves the note byte for byte", async () => {
  const text = await fixture();
  const { order } = readModel(text);
  assert.equal(withOrder(text, withCss(order, bookCss(order))), text);

  const bodies = [
    "",
    "# Body\n\n- [[A]]\n",
    "```css\n```\n",
    "- [[A]]\n\n```css\np {}\n\n\n```\ntrailing",
    "```css\nunclosed {",
  ];
  for (const body of bodies) {
    const read = readOrder(body);
    const again = withCss(read, bookCss(read));
    assert.equal(bookCss(again), bookCss(read), body);
    if (body.includes("```css\n")) {
      assert.ok(writeOrder(again).startsWith(body), body);
    } else assert.equal(writeOrder(again), body);
  }
});

test("an edit replaces only the lines inside the fence", async () => {
  const text = await fixture();
  const { order } = readModel(text);
  const css = "p {\n  text-indent: 2em;\n}\n";
  const written = withOrder(text, withCss(order, css));

  assert.equal(bookCss(readModel(written).order), css);
  const [before, after] = text.split(bookCss(order));
  assert.ok(written.startsWith(`${before ?? ""}${css}`));
  assert.ok(written.endsWith(after ?? ""));
});

test("a note with no fence gets one at the end of its body, and empty CSS adds none", () => {
  const order = readOrder("# Body\n\n- [[A]]\n");
  assert.equal(withCss(order, ""), order);

  const written = writeOrder(withCss(order, "p {}"));
  assert.equal(written, "# Body\n\n- [[A]]\n\n```css\np {}\n```\n");
  assert.equal(bookCss(readOrder(written)), "p {}");
});

test("a line of CSS that looks like an entry or a heading stays in the fence", () => {
  const order = readOrder("# Body\n\n- [[A]]\n\n```css\n- [[B]]\n# C\n```\n");
  assert.deepEqual(
    entries(order).map((entry) => entry.link),
    ["A"],
  );
  assert.equal(bookCss(order), "- [[B]]\n# C");
});

// What this tier does not cover: a second `css` fence, which is kept
// as written and never read, and a fence written with tildes, which is
// not the book's CSS.
