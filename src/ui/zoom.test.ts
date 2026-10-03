import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOSEST,
  FIT,
  clampZoom,
  percentOf,
  pinchZoom,
  scrollTo,
  shareOf,
  steppedIn,
  steppedOut,
  wheelZoom,
  zooms,
} from "@/ui/zoom";

test("single and spread zoom, and the grid does not", () => {
  assert.equal(zooms("single"), true);
  assert.equal(zooms("spread"), true);
  assert.equal(zooms("grid"), false);
});

test("a zoom stays between fit and the closest", () => {
  assert.equal(clampZoom(0.2), FIT);
  assert.equal(clampZoom(2.5), 2.5);
  assert.equal(clampZoom(40), CLOSEST);
  assert.equal(clampZoom(Number.NaN), FIT);
});

test("the keys step from fit to the closest and back to fit", () => {
  const up: number[] = [];
  for (let zoom = FIT; zoom < CLOSEST; zoom = steppedIn(zoom)) up.push(zoom);
  assert.deepEqual(up, [1, 1.25, 1.5, 2, 3, 4, 6]);
  assert.equal(steppedIn(CLOSEST), CLOSEST);
  const down: number[] = [];
  for (let zoom = CLOSEST; zoom > FIT; zoom = steppedOut(zoom)) down.push(zoom);
  assert.deepEqual(down, [8, 6, 4, 3, 2, 1.5, 1.25]);
  assert.equal(steppedOut(FIT), FIT);
});

test("a step from between two stops goes to the nearest stop that way", () => {
  assert.equal(steppedIn(1.7), 2);
  assert.equal(steppedOut(1.7), 1.5);
  // A pinch that ends a hair off a stop is on it.
  assert.equal(steppedIn(1.999), 3);
  assert.equal(steppedOut(2.001), 1.5);
});

test("the percentage is the zoom in whole percent", () => {
  assert.equal(percentOf(FIT), 100);
  assert.equal(percentOf(1.25), 125);
  assert.equal(percentOf(1.3349), 133);
});

test("a wheel toward the reader zooms in, and the same wheel back undoes it", () => {
  const closer = wheelZoom(2, -120);
  assert.ok(closer > 2);
  assert.ok(Math.abs(wheelZoom(closer, 120) - 2) < 1e-9);
  assert.equal(wheelZoom(FIT, 500), FIT);
  assert.equal(wheelZoom(CLOSEST, -500), CLOSEST);
});

test("a pinch scales by how far the fingers moved apart", () => {
  assert.equal(pinchZoom(1, 100, 250), 2.5);
  assert.equal(pinchZoom(2, 200, 100), 1);
  assert.equal(pinchZoom(1, 100, 50), FIT);
  assert.equal(pinchZoom(2, 100, 1000), CLOSEST);
  assert.equal(pinchZoom(2, 0, 100), 2);
});

test("the place under a point stays under it when the sheet grows", () => {
  // A deterministic walk over sheets, zooms and points.
  let seed = 7;
  const next = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let run = 0; run < 200; run += 1) {
    const before = { start: next() * 400 - 200, size: 100 + next() * 600 };
    const point = before.start + next() * before.size;
    const scale = 1 + next() * 7;
    // The sheet after the zoom, laid out wherever the browser put it.
    const after = { start: next() * 400 - 200, size: before.size * scale };
    const share = shareOf(before, point);
    const scroll = scrollTo(after, share, point);
    const moved = { start: after.start - scroll, size: after.size };
    assert.ok(Math.abs(shareOf(moved, point) - share) < 1e-9);
  }
});

test("a sheet with no size has no share to keep", () => {
  assert.equal(shareOf({ start: 10, size: 0 }, 40), 0);
});

// What this tier does not cover: the page drawn at the zoom, the scroll
// a browser clamps at the sheet's edge, and the wheel and touch events
// themselves, which the e2e job sends to real Obsidian.
