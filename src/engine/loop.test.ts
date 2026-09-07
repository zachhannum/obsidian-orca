import assert from "node:assert/strict";
import { test } from "node:test";
import type { Op } from "fleuron";
import { Loop, type Clock } from "@/engine/loop";

/** A clock the test steps itself, so nothing here waits on a real one. */
class Steps implements Clock {
  private waiting: (() => void)[] = [];

  after(_ms: number, fire: () => void): () => void {
    const at = this.waiting.length;
    this.waiting.push(fire);
    return () => {
      this.waiting[at] = () => undefined;
    };
  }

  /** Runs every wait that has come due and not been cancelled. */
  tick(): void {
    const due = this.waiting;
    this.waiting = [];
    for (const fire of due) fire();
  }
}

/** The op a keystroke in `note` plans. */
function typed(note: string, text: string): Op[] {
  return [{ op: "edit", name: note, text }];
}

test("a burst of keystrokes crosses as one render", async () => {
  const clock = new Steps();
  const rendered: Op[][] = [];
  const loop = new Loop((ops) => {
    rendered.push(ops);
    return Promise.resolve();
  }, clock);

  for (const text of ["I", "It", "It i", "It is"]) {
    loop.edit("typed:one.md", typed("one.md", text));
  }
  clock.tick();
  await loop.settled;

  // Four keystrokes, one render, and it carries the last of them: a
  // superseded render is one that never started.
  assert.equal(rendered.length, 1);
  assert.deepEqual(rendered[0], typed("one.md", "It is"));
});

test("two chapters typed in one wait cross together, in the order they were typed", async () => {
  const clock = new Steps();
  const rendered: Op[][] = [];
  const loop = new Loop((ops) => {
    rendered.push(ops);
    return Promise.resolve();
  }, clock);

  loop.edit("typed:one.md", typed("one.md", "a"));
  loop.edit("typed:two.md", typed("two.md", "b"));
  loop.edit("typed:one.md", typed("one.md", "c"));
  clock.tick();
  await loop.settled;

  assert.deepEqual(rendered, [
    [...typed("one.md", "c"), ...typed("two.md", "b")],
  ]);
});

test("an edit typed under a render in flight rides the run after it", async () => {
  const clock = new Steps();
  const rendered: Op[][] = [];
  /** The first render's answer, which the test holds back. */
  let release: (() => void) | undefined;
  const loop = new Loop((ops) => {
    rendered.push(ops);
    if (release !== undefined) return Promise.resolve();
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  }, clock);

  loop.edit("typed:one.md", typed("one.md", "a"));
  clock.tick();
  loop.edit("typed:one.md", typed("one.md", "b"));
  clock.tick();
  assert.equal(rendered.length, 1);

  release?.();
  await loop.settled;

  // The engine holds one document, so the second render is the run
  // after the first rather than one alongside it.
  assert.deepEqual(rendered, [typed("one.md", "a"), typed("one.md", "b")]);
});

test("a wait dropped before it comes due renders nothing", async () => {
  const clock = new Steps();
  const rendered: Op[][] = [];
  const loop = new Loop((ops) => {
    rendered.push(ops);
    return Promise.resolve();
  }, clock);

  loop.edit("typed:one.md", typed("one.md", "a"));
  loop.stop();
  clock.tick();
  await loop.settled;

  assert.deepEqual(rendered, []);
});

// What this tier does not cover: the interval itself, since the clock
// here is stepped rather than run. Whether the wait in front of a real
// engine is long enough to coalesce real typing is the e2e run's.
