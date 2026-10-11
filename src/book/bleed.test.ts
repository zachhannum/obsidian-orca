import assert from "node:assert/strict";
import { test } from "node:test";
import type { DrawItem, Page } from "fleuron";
import { shortOfBleed } from "@/book/bleed";

const WIDTH = 432;
const HEIGHT = 648;

function page(bleed: number, items: DrawItem[]): Page {
  return {
    number: 1,
    side: "recto",
    width: WIDTH,
    height: HEIGHT,
    bleed,
    slug: 0,
    sections: [],
    links: [],
    items,
  };
}

function image(x: number, y: number, w: number, h: number): DrawItem {
  return { kind: "image", x, y, w, h, asset: 0, alpha: 255, blend: "normal", layer: 0 };
}

function fill(x: number, y: number, w: number, h: number): DrawItem {
  return { kind: "rect", x, y, w, h, color: "#000000", blend: "normal", layer: 0 };
}

test("a page whose art stops at the trim is named by its place in the book", () => {
  const inside = page(9, [image(54, 54, 200, 300)]);
  const atTrim = page(9, [image(0, 0, WIDTH, HEIGHT)]);
  const oneEdge = page(9, [image(100, 100, WIDTH - 100, 200)]);

  assert.deepEqual(shortOfBleed([inside, atTrim, inside, oneEdge]), [1, 3]);
});

test("art that reaches the edge of the bleed is not named, and neither is art part of the way there", () => {
  const whole = page(9, [image(-9, -9, WIDTH + 18, HEIGHT + 18)]);
  const partWay = page(9, [image(-4, 100, 200, 200)]);

  assert.deepEqual(shortOfBleed([whole]), []);
  assert.deepEqual(shortOfBleed([partWay]), [0]);
});

test("a page with no bleed is never named", () => {
  assert.deepEqual(shortOfBleed([page(0, [image(0, 0, WIDTH, HEIGHT)])]), []);
});

test("a filled box counts as art, and the marks past the bleed and the text do not", () => {
  const band = page(9, [fill(0, 600, WIDTH, 48)]);
  const marks = page(9, [fill(-33, 0, 18, 0.5), fill(0, -33, 0.5, 18)]);

  assert.deepEqual(shortOfBleed([band, marks]), [0]);
});

// What this tier does not cover: a page the engine sets from a real
// book, which the e2e suite exports, and art cut to a shape, where the
// box reaches the trim and the picture inside it does not.
