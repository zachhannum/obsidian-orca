import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PLUGIN } from "./harness/launch";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. It sits at the top of the vault. */
const BOOK = "Pride and Prejudice.md";

/** The name the author types in place of the one export offers. */
const NAME = "On the phone";

/** The file that name gives the PDF. */
const FILE = `${NAME}.pdf`;

/** A face the fixture vault carries. */
const FIXTURE_FONT = "Alegreya";

test("under mobile emulation the book is set from the vault's faces and exports into the vault under the name given", async ({
  obsidian,
  book,
  exporting,
  panel,
  vault,
}) => {
  // The window reloads into emulation and back, so the next spec opens
  // on the desktop paths again.
  await obsidian.emulateMobile(true);
  try {
    await book.open();
    await book.settled(BOOK);

    await panel.open();
    await panel.pick();
    expect(await panel.offered()).toContain(FIXTURE_FONT);
    // The list is the index, and every family in the index is the vault's.
    const where = await obsidian.page.evaluate(async (id) => {
      const orca = window.app.plugins.plugins[id] as
        | { families?: Promise<{ families: { where: string }[] }> }
        | undefined;
      const index = await orca?.families;
      return index?.families.map((family) => family.where);
    }, PLUGIN);
    expect(where?.length).toBe(await panel.offering());
    expect(new Set(where)).toEqual(new Set(["vault"]));
    await obsidian.page.keyboard.press("Escape");

    vault.touch(FILE);
    await exporting.open();
    await exporting.reaches("ready");
    await expect(exporting.choose).toHaveCount(0);
    await exporting.formats("pdf");
    await exporting.destination.fill(NAME);
    await exporting.write.click();
    await exporting.reaches("written");

    const folder = await mkdtemp(path.join(tmpdir(), "orca-mobile-"));
    try {
      const written = path.join(folder, FILE);
      await writeFile(written, await vault.bytes(FILE));
      const checked = spawnSync("qpdf", ["--check", written], { encoding: "utf8" });
      expect(checked.status, checked.stdout + checked.stderr).toBe(0);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    await exporting.close();
  } finally {
    await obsidian.emulateMobile(false);
  }
});

// What this suite does not cover: Obsidian on a real phone, where Node
// is absent rather than unused, which the Node tier's bundle test
// stands in for; the phone layout; and the memory a real iOS device
// allows.
//
// Emulation has no Capacitor, so the index here is the one a phone
// falls back to when its routes are not there. The Node tier checks
// the routes, the read of a file with no suffix, the range handling
// and the vault winning a family name, all against fakes. No tier
// checks Capacitor's real routes, whether the web view answers a range
// with 206, how long the scan of a phone's faces takes, or the picker
// row and the PDF for a system face on a phone.
