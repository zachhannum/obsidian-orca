import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneRoutes, type Get } from "@/ui/phone";

/** One fetch the fake saw. */
interface Asked {
  url: string;
  headers: Record<string, string>;
}

const BYTES = Uint8Array.of(1, 2, 3, 4);

function getting(status: number): { get: Get; asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    get: async (url, init) => {
      asked.push({ url, headers: init.headers });
      return { status, arrayBuffer: async () => BYTES.slice().buffer };
    },
  };
}

const convertFileSrc = (path: string): string =>
  `capacitor://localhost/_capacitor_file_${path}`;

test("a fetch of a range sends a Range header to the converted URL, and a whole fetch sends none", async () => {
  const { get, asked } = getting(206);
  const routes = phoneRoutes({
    Capacitor: {
      Plugins: { Filesystem: { readdir: async () => ({ files: [] }) } },
      convertFileSrc,
    },
    fetch: get,
  });
  assert.ok(routes !== undefined);

  const ranged = await routes.fetch("/System/Library/Fonts/A.ttf", {
    at: 12,
    length: 4,
  });
  assert.deepEqual(ranged, { status: 206, bytes: BYTES });
  await routes.fetch("/System/Library/Fonts/A.ttf");

  const url = "capacitor://localhost/_capacitor_file_/System/Library/Fonts/A.ttf";
  assert.deepEqual(asked, [
    { url, headers: { Range: "bytes=12-15" } },
    { url, headers: {} },
  ]);
});

test("a listed entry is a folder only when Capacitor says so, and a bare name is a file", async () => {
  const seen: string[] = [];
  const routes = phoneRoutes({
    fetch: getting(200).get,
    Capacitor: {
      Plugins: {
        Filesystem: {
          readdir: async ({ path }: { path: string }) => {
            seen.push(path);
            return {
              files: [
                { name: "Core", type: "directory" },
                { name: "A.ttf", type: "file" },
                "B.ttf",
              ],
            };
          },
        },
      },
      convertFileSrc,
    },
  });

  assert.deepEqual(await routes?.list("file:///System/Library/Fonts"), [
    { name: "Core", folder: true },
    { name: "A.ttf", folder: false },
    { name: "B.ttf", folder: false },
  ]);
  assert.deepEqual(seen, ["file:///System/Library/Fonts"]);
});

test("a window with no Capacitor, no Filesystem plugin or no convertFileSrc has no routes", () => {
  const Filesystem = { readdir: async () => ({ files: [] }) };
  const fetch = getting(200).get;
  assert.equal(phoneRoutes(undefined), undefined);
  assert.equal(phoneRoutes({ fetch }), undefined);
  assert.equal(phoneRoutes({ fetch, Capacitor: { convertFileSrc } }), undefined);
  assert.equal(
    phoneRoutes({ fetch, Capacitor: { Plugins: {}, convertFileSrc } }),
    undefined,
  );
  assert.equal(phoneRoutes({ fetch, Capacitor: { Plugins: { Filesystem } } }), undefined);
  assert.ok(
    phoneRoutes({
      fetch,
      Capacitor: { Plugins: { Filesystem }, convertFileSrc },
    }),
  );
});

// What this tier does not cover: Capacitor itself, the URL its
// `convertFileSrc` gives for a path with a space in it, and the answer
// the web view gives a range.
