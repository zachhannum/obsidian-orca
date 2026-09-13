import assert from "node:assert/strict";
import { test } from "node:test";
import { Settled } from "@/ui/settled";
import type { Clock } from "@/ui/writer";

function manualClock(): Clock & { settle(): void } {
  let fire: (() => void) | undefined;
  return {
    after(_ms, fired) {
      fire = fired;
      return () => {
        if (fire === fired) fire = undefined;
      };
    },
    settle() {
      const fired = fire;
      fire = undefined;
      fired?.();
    },
  };
}

test("edits to the CSS write on settle, once, with the last of them", () => {
  const clock = manualClock();
  const saved: [string, string][] = [];
  const settled = new Settled((book, css) => saved.push([book, css]), clock);

  settled.put("Book.md", "p");
  settled.put("Book.md", "p {");
  settled.put("Book.md", "p {}");
  assert.deepEqual(saved, []);

  clock.settle();
  assert.deepEqual(saved, [["Book.md", "p {}"]]);
  clock.settle();
  assert.equal(saved.length, 1);
});

test("CSS for another book writes the one still waiting first", () => {
  const clock = manualClock();
  const saved: [string, string][] = [];
  const settled = new Settled((book, css) => saved.push([book, css]), clock);

  settled.put("One.md", "a {}");
  settled.put("Two.md", "b {}");
  assert.deepEqual(saved, [["One.md", "a {}"]]);

  settled.flush();
  assert.deepEqual(saved, [
    ["One.md", "a {}"],
    ["Two.md", "b {}"],
  ]);
  settled.flush();
  assert.equal(saved.length, 2);
});

// What this tier does not cover: the write itself, which goes through
// the book view's writer when one is open, and which the e2e suite
// waits on in Obsidian.
