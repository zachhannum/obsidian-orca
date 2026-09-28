import assert from "node:assert/strict";
import { test } from "node:test";
import { exportName, exportPath } from "@/book/export";

const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/u;

test("the title names the file", () => {
  assert.equal(exportName({ title: "The Long Road" }, "pdf"), "The Long Road.pdf");
});

test("a missing, empty or blank title falls back to Untitled", () => {
  assert.equal(exportName({}, "pdf"), "Untitled.pdf");
  assert.equal(exportName({ title: "" }, "pdf"), "Untitled.pdf");
  assert.equal(exportName({ title: " \t\n " }, "pdf"), "Untitled.pdf");
});

test("a title of only forbidden characters and dots falls back to Untitled", () => {
  assert.equal(exportName({ title: '/:*?"<>|\\ ..' }, "pdf"), "Untitled.pdf");
});

test("forbidden and control characters are stripped", () => {
  assert.equal(exportName({ title: 'Part 1: A/B "Dawn"?\u0007' }, "pdf"), "Part 1 AB Dawn.pdf");
});

test("runs of whitespace collapse to one space", () => {
  assert.equal(exportName({ title: "  The \t Long\n\nRoad  " }, "pdf"), "The Long Road.pdf");
});

test("trailing dots and spaces are trimmed", () => {
  assert.equal(exportName({ title: "Wait for it. . ." }, "pdf"), "Wait for it.pdf");
});

test("the default vault destination is the book note's folder and the export name", () => {
  const metadata = { title: "Pride and Prejudice" };
  assert.equal(exportPath("Books/Austen/Pride.md", metadata, "pdf"), "Books/Austen/Pride and Prejudice.pdf");
  assert.equal(exportPath("Pride.md", metadata, "pdf"), "Pride and Prejudice.pdf");
});

/** A small seeded generator, so a failing title can be run again. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const ALPHABET = ["a", "Z", "0", " ", "\t", "\n", ".", "/", "\\", ":", "*", "?", '"', "<", ">", "|", "\u0000", "\u001f", "\u007f", "é", "-"];

function title(next: () => number): string {
  const length = Math.floor(next() * 12);
  let out = "";
  for (let at = 0; at < length; at += 1) {
    out += ALPHABET[Math.floor(next() * ALPHABET.length)] ?? "";
  }
  return out;
}

test("any title gives a non-empty name with no forbidden character that ends with the extension", () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const next = random(seed);
    const written = title(next);
    const name = exportName({ title: written }, "pdf");
    assert.ok(name.endsWith(".pdf"), `seed ${seed}`);
    const base = name.slice(0, -".pdf".length);
    assert.notEqual(base, "", `seed ${seed}`);
    assert.doesNotMatch(base, FORBIDDEN, `seed ${seed}`);
    assert.doesNotMatch(base, /[. ]$/, `seed ${seed}`);
    assert.doesNotMatch(base, /^\s|\s{2}/, `seed ${seed}`);
  }
});

// What this tier does not cover: Windows reserved names such as CON or
// NUL, a name longer than a file system allows, and an extension that
// itself carries a forbidden character.
