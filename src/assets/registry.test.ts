import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { directoryVault } from "@/assets/directory";
import { Registry, contentKey, type Later, type Revoke } from "@/assets/registry";
import type { VaultAdapter } from "@/assets/vault";

const root = process.env["ORCA_ROOT"] ?? process.cwd();
const fixture = directoryVault(path.join(root, "fixture"));

/** A file the fixture vault has, standing in for a face. */
const FILE = "Chapter Twelve.md";

/** The same file, named the other way a vault path is written. */
const AGAIN = `/${FILE}`;

/** The fixture vault, with every binary read counted. */
function counted(): { vault: VaultAdapter; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    vault: {
      ...fixture,
      readBinary: (at) => {
        reads.push(at);
        return fixture.readBinary(at);
      },
    },
  };
}

/** A clock that holds the work behind the paint until the test runs it. */
function held(): { later: Later; run: () => void } {
  const waiting: (() => void)[] = [];
  return {
    later: (work) => waiting.push(work),
    run: () => {
      for (const work of waiting.splice(0)) work();
    },
  };
}

/** The urls a registry gave back. */
function revoked(): { revoke: Revoke; urls: string[] } {
  const urls: string[] = [];
  return { revoke: (url) => urls.push(url), urls };
}

test("a file is hashed once, however many paths name it", async () => {
  const { vault, reads } = counted();
  const registry = new Registry(vault);

  const keys = await Promise.all([
    registry.key(FILE),
    registry.key(FILE),
    registry.key(AGAIN),
  ]);
  await registry.key(FILE);

  assert.equal(reads.length, 2, "one read per path, not one per ask");
  assert.equal(new Set(keys).size, 1, "the same file keys the same way");
  assert.equal(keys[0], await contentKey(new Uint8Array(await fixture.readBinary(FILE))));
});

test("hashing runs behind the paint rather than in front of it", async () => {
  const { vault, reads } = counted();
  const { later, run } = held();
  const registry = new Registry(vault, () => undefined, later);

  registry.prime([FILE, AGAIN]);
  assert.deepEqual(reads, [], "priming reads nothing on the way past");

  run();
  const key = await registry.key(FILE);
  assert.deepEqual(reads, [FILE, AGAIN]);
  assert.equal(key, await registry.key(AGAIN));

  // A path already hashed is not read again by a later prime.
  registry.prime([FILE]);
  run();
  assert.equal(reads.length, 2);
});

test("eviction gives back the url it held, and closing gives back the rest", () => {
  const { revoke, urls } = revoked();
  const registry = new Registry(fixture, revoke);

  registry.hold("one", "blob:one");
  registry.hold("two", "blob:two");
  registry.hold("one", "blob:one-again");
  assert.deepEqual(urls, ["blob:one"], "a url it replaces goes at once");
  assert.equal(registry.url("one"), "blob:one-again");

  registry.evict("one");
  assert.deepEqual(urls, ["blob:one", "blob:one-again"]);
  assert.equal(registry.url("one"), undefined);

  registry.crossed("two", 3);
  registry.close();
  assert.deepEqual(urls, ["blob:one", "blob:one-again", "blob:two"]);
  assert.equal(registry.url("two"), undefined);
  assert.equal(registry.fontId("two"), undefined);
  assert.equal(registry.sent("two"), false, "no session outlives its registry");
});

test("a read that fails is not kept, so the next ask reads the file again", async () => {
  const { vault, reads } = counted();
  const registry = new Registry(vault);

  await assert.rejects(registry.key("nothing here.otf"));
  await assert.rejects(registry.key("nothing here.otf"));
  assert.equal(reads.length, 2);
});

// What this tier does not cover: the blob urls a painter draws an image
// from, which wait on the engine handing its own asset cache out; and
// `whenIdle` itself, which is the browser's idle time and has no clock
// a test can step.
