import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceOf, footPlace, splits } from "@/ui/device";

const DESKTOP = { isMobile: false, isPhone: false, isTablet: false };
const PHONE = { isMobile: true, isPhone: true, isTablet: false };
const TABLET = { isMobile: true, isPhone: false, isTablet: true };

test("the device is read from Obsidian's flags", () => {
  assert.equal(deviceOf(DESKTOP), "desktop");
  assert.equal(deviceOf(PHONE), "phone");
  assert.equal(deviceOf(TABLET), "tablet");
  assert.equal(deviceOf({ isMobile: true, isPhone: false, isTablet: false }), "phone");
});

test("a phone offers no split, and a tablet and the desktop do", () => {
  assert.equal(splits("phone"), false);
  assert.equal(splits("tablet"), true);
  assert.equal(splits("desktop"), true);
});

test("the foot is in the status bar on desktop and under the page on mobile", () => {
  const upright = { width: 390, height: 700 };
  assert.equal(footPlace("desktop", upright), "status");
  assert.equal(footPlace("phone", upright), "under");
  assert.equal(footPlace("tablet", { width: 1180, height: 700 }), "under");
});

test("a phone on its side has the foot in the preview's bar", () => {
  assert.equal(footPlace("phone", { width: 844, height: 300 }), "bar");
  assert.equal(footPlace("phone", { width: 300, height: 300 }), "under");
});

// What this tier does not cover: the flags themselves, which Obsidian
// sets from the window's size as it loads, and the surfaces that read
// the device, which the e2e suite opens at a phone's size and a
// tablet's.
