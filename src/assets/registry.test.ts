import assert from "node:assert/strict";
import { paintPage, type Intrinsic, type Page } from "fleuron";
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

/** The image the fixture book embeds. */
const DEVICE = "images/device.png";

/** Its own idea of its size, as the header has it. */
const SIZE: Intrinsic = { width: 220, height: 132, dpiX: 96, dpiY: 96 };

/** One page with that image on it, as the engine would place it. */
const PLACED: Page = {
  number: 1,
  side: "recto",
  width: 396,
  height: 612,
  sections: [],
  items: [{ kind: "image", x: 54, y: 54, w: 165, h: 99, asset: 0 }],
};

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

test("a page draws an image from the bytes that crossed, as a url of its own", async () => {
  const registry = new Registry(fixture);
  const device = await registry.take(DEVICE);

  registry.image("device.png", device);
  // Two urls over one file share the key, so they share what draws it.
  registry.image("images/device.png", device);
  const drawn = registry.imageUrl("device.png");

  assert.ok(drawn !== undefined && drawn.startsWith("blob:"));
  assert.equal(registry.imageUrl("images/device.png"), drawn);
  assert.equal(registry.imageUrl("nothing here.png"), undefined);
  assert.deepEqual(
    new Uint8Array(await (await fetch(drawn)).arrayBuffer()),
    device.bytes,
    "the pixels a page decodes are the ones layout was set from",
  );

  const markup = paintPage(PLACED, {
    assets: [{ url: "device.png", intrinsic: SIZE }],
    asset: (image) => registry.imageUrl(image.url),
  });
  assert.ok(markup.includes(drawn), "the painter draws from the url it was given");

  registry.close();
  await assert.rejects(fetch(drawn), "no url outlives its registry");
});

test("a read that fails is not kept, so the next ask reads the file again", async () => {
  const { vault, reads } = counted();
  const registry = new Registry(vault);

  await assert.rejects(registry.key("nothing here.otf"));
  await assert.rejects(registry.key("nothing here.otf"));
  assert.equal(reads.length, 2);
});

// What this tier does not cover: `whenIdle` itself, which is the
// browser's idle time and has no clock a test can step.
