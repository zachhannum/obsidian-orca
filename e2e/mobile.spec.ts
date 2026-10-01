import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TO_THE_LEFT, TO_THE_RIGHT } from "./harness/book";
import { PLUGIN } from "./harness/launch";
import { DEVICES } from "./harness/obsidian";
import { expect, test } from "./harness/test";

/** The book note in the fixture vault. It sits at the top of the vault. */
const BOOK = "Pride and Prejudice.md";

/** The name the author types in place of the one export offers. */
const NAME = "On the phone";

/** The file that name gives the PDF. */
const FILE = `${NAME}.pdf`;

/** A chapter of that book. */
const CHAPTER = "Chapter Twelve.md";

/** The item a chapter's file menu splits the preview from. */
const SPLIT = "Open preview to the right";

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
    // The list is the index, and every family in the index is the vault's
    // or the one the engine carries.
    const where = await obsidian.page.evaluate(async (id) => {
      const orca = window.app.plugins.plugins[id] as
        | { families?: Promise<{ families: { where: string }[] }> }
        | undefined;
      const index = await orca?.families;
      return index?.families.map((family) => family.where);
    }, PLUGIN);
    expect(where?.length).toBe(await panel.offering());
    expect(new Set(where)).toEqual(new Set(["vault", "engine"]));
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

for (const device of ["phone", "tablet"] as const) {
  test(`the harness runs a spec at a ${device}'s size, and Obsidian reads the window as a ${device}`, async ({
    obsidian,
  }) => {
    const other = device === "phone" ? "tablet" : "phone";
    await obsidian.mobile(device);
    try {
      // Obsidian writes these classes from `Platform`, which the window
      // hands to plugins alone.
      const body = obsidian.page.locator("body");
      await expect(body).toHaveClass(/\bis-mobile\b/);
      await expect(body).not.toHaveClass(new RegExp(`\\bis-${other}\\b`));
      expect(
        await obsidian.page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
        })),
      ).toEqual(DEVICES[device]);
      await expect(obsidian.page.locator("body")).toHaveClass(new RegExp(`\\bis-${device}\\b`));
    } finally {
      await obsidian.emulateMobile(false);
    }
  });
}

test("a phone turned on its side is still a phone", async ({ obsidian }) => {
  await obsidian.mobile("phone");
  try {
    await obsidian.turn();
    await expect
      .poll(() => obsidian.page.evaluate(() => window.innerWidth > window.innerHeight))
      .toBe(true);
    await expect(obsidian.page.locator("body")).toHaveClass(/\bis-phone\b/);
  } finally {
    await obsidian.emulateMobile(false);
  }
});

test("a phone registers neither split command and draws no split in a chapter's menu", async ({
  obsidian,
  book,
}) => {
  await obsidian.mobile("phone");
  try {
    await book.open();
    await book.settled(BOOK);
    expect(await obsidian.registered(TO_THE_RIGHT)).toBe(false);
    expect(await obsidian.registered(TO_THE_LEFT)).toBe(false);
    // `Add to book` is asked of the same cache, so the menu is whole
    // once the chapter's other item is on it.
    await expect
      .poll(async () => (await obsidian.fileMenu(CHAPTER)).length)
      .toBeGreaterThan(0);
    expect(await obsidian.fileMenu(CHAPTER)).not.toContain(SPLIT);
  } finally {
    await obsidian.emulateMobile(false);
  }
});

test("a tablet offers both splits", async ({ obsidian, book }) => {
  await obsidian.mobile("tablet");
  try {
    await book.open();
    await book.settled(BOOK);
    expect(await obsidian.registered(TO_THE_RIGHT)).toBe(true);
    expect(await obsidian.registered(TO_THE_LEFT)).toBe(true);
    await obsidian.fileMenu(CHAPTER, SPLIT);
    await obsidian.detach("orca-book-preview");
  } finally {
    await obsidian.emulateMobile(false);
  }
});

// What this suite does not cover: Obsidian on a real phone, where Node
// is absent rather than unused, which the Node tier's bundle test
// stands in for; the phone layout; and the memory a real iOS device
// allows.
