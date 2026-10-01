import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetError } from "@/assets/errors";
import { face, fontFiles } from "@/assets/fakes";
import {
  fontDirectories,
  fontIndex,
  MANAGED_FONTS,
  scanFonts,
  VAULT_FONTS,
  type Found,
} from "@/assets/fonts";
import { phoneFonts, type PhoneRoutes } from "@/assets/phone";

/** One fetch a fake saw. */
interface Asked {
  path: string;
  ranged: boolean;
}

/** Routes over files at fixed paths, and the fetches they saw. */
function routes(
  files: Readonly<Record<string, Uint8Array>>,
  ranges: boolean,
): { routes: PhoneRoutes; asked: Asked[] } {
  const source = fontFiles(files);
  const asked: Asked[] = [];
  return {
    asked,
    routes: {
      list: async (url) => {
        if (!url.startsWith("file:///")) throw new Error(`${url} is not a file URL`);
        const directory = url.slice("file://".length);
        const listing = await source.list(directory);
        const entry = (folder: boolean) => (path: string) => ({
          name: path.slice(directory.length + 1),
          folder,
        });
        return [...listing.files.map(entry(false)), ...listing.folders.map(entry(true))];
      },
      fetch: async (path, range) => {
        asked.push({ path, ranged: range !== undefined });
        const bytes = files[path];
        if (bytes === undefined) return { status: 404, bytes: new Uint8Array(0) };
        if (range === undefined || !ranges) return { status: 200, bytes };
        return { status: 206, bytes: bytes.subarray(range.at, range.at + range.length) };
      },
    },
  };
}

const IOS = fontDirectories("ios", "");

/** The system's faces and the managed ones, as one scan of the platform. */
async function scanPhone(phone: PhoneRoutes): Promise<Found> {
  const files = phoneFonts(phone);
  const system = await scanFonts(files, IOS, "platform");
  const managed = await scanFonts(files, [MANAGED_FONTS], "platform", { byBytes: true });
  return {
    faces: [...system.faces, ...managed.faces],
    refused: [...system.refused, ...managed.refused],
  };
}

const woff = (): Uint8Array => {
  const bytes = face("Webbed", "Regular");
  bytes.set([0x77, 0x4f, 0x46, 0x46]);
  return bytes;
};

const PHONE = {
  "/System/Library/Fonts/Core/Sablon.ttf": face("Sablon", "Regular"),
  "/System/Library/Fonts/Core/Text.ttf": face("Text", "Regular"),
  "/System/Library/Fonts/Core/SFNS.ttf": face(".SF NS", "Regular"),
  [`${MANAGED_FONTS}/0A1B`]: face("Halyard", "Regular"),
  [`${MANAGED_FONTS}/2C3D`]: woff(),
  [`${MANAGED_FONTS}/4E5F`]: new Uint8Array(64),
};

const VAULT = fontFiles({ [`${VAULT_FONTS}/Sablon.otf`]: face("Sablon", "Book") });

test("a phone's system faces are indexed beside the vault's, and the vault wins the name", async () => {
  const platform = await scanPhone(routes(PHONE, true).routes);
  const index = fontIndex(platform, await scanFonts(VAULT, [VAULT_FONTS], "vault"));

  assert.deepEqual(
    index.families.map((family) => [family.name, family.where, family.faces[0]?.path]),
    [
      ["Halyard", "platform", `${MANAGED_FONTS}/0A1B`],
      ["Sablon", "vault", `${VAULT_FONTS}/Sablon.otf`],
      ["Text", "platform", "/System/Library/Fonts/Core/Text.ttf"],
    ],
  );
});

test("a managed face with no suffix is indexed by its bytes, and a WOFF or a stray file is not", async () => {
  const files = phoneFonts(routes(PHONE, true).routes);

  const sniffed = await scanFonts(files, [MANAGED_FONTS], "platform", { byBytes: true });
  assert.deepEqual(
    sniffed.faces.map((one) => one.family),
    ["Halyard"],
  );
  assert.deepEqual(sniffed.refused, []);

  const named = await scanFonts(files, [MANAGED_FONTS], "platform");
  assert.deepEqual(named.faces, []);
});

test("a scan asks for ranges only, and a route that answers whole is fetched once a file", async () => {
  const ranged = routes(PHONE, true);
  const byRange = await scanPhone(ranged.routes);
  assert.ok(ranged.asked.length > 0);
  assert.deepEqual(
    ranged.asked.filter((one) => !one.ranged),
    [],
    "no file is fetched whole",
  );

  const whole = routes(PHONE, false);
  const byWhole = await scanPhone(whole.routes);
  assert.deepEqual(byWhole, byRange);
  assert.deepEqual(
    whole.asked.map((one) => one.path).sort(),
    Object.keys(PHONE).sort(),
    "each file is fetched once",
  );
});

test("a face crosses whole, and a file that is not there is an asset error", async () => {
  const { routes: phone, asked } = routes(PHONE, true);
  const files = phoneFonts(phone);
  const at = `${MANAGED_FONTS}/0A1B`;

  assert.deepEqual(await files.whole(at), PHONE[at]);
  assert.deepEqual(asked, [{ path: at, ranged: false }]);
  await assert.rejects(files.whole("/System/Library/Fonts/None.ttf"), AssetError);
});

test("routes that fail give no platform faces and no rejection", async () => {
  const working = routes(PHONE, true).routes;
  const failing: Record<string, PhoneRoutes> = {
    "a list that rejects": {
      ...working,
      list: () => Promise.reject(new Error("the plugin is not there")),
    },
    "a fetch that rejects": {
      ...working,
      fetch: () => Promise.reject(new TypeError("Load failed")),
    },
    "a fetch that is forbidden": {
      ...working,
      fetch: async () => ({ status: 403, bytes: new Uint8Array(0) }),
    },
  };

  for (const [name, phone] of Object.entries(failing)) {
    assert.deepEqual(await scanPhone(phone), { faces: [], refused: [] }, name);
  }
});

test("a phone's interface face is refused as hidden", async () => {
  const platform = await scanPhone(routes(PHONE, true).routes);
  const index = fontIndex(platform, { faces: [], refused: [] });

  assert.deepEqual(index.refused, [
    { path: "/System/Library/Fonts/Core/SFNS.ttf", face: 0, why: "hidden" },
  ]);
  assert.equal(
    index.families.some((family) => family.name.includes("SF")),
    false,
  );
});

// What this tier does not cover: Capacitor's real routes, whether the
// web view answers a range with 206 or with the whole file, and the
// cost of a scan on a device.
