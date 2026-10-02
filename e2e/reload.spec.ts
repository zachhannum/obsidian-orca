import { NAVIGATOR } from "./harness/navigator";
import { PANEL } from "./harness/panel";
import { expect, test } from "./harness/test";

test("reloading the plugin leaves one navigator and one design panel", async ({
  obsidian,
}) => {
  await expect.poll(async () => obsidian.tabs(NAVIGATOR)).toBe(1);
  await expect.poll(async () => obsidian.tabs(PANEL)).toBe(1);

  await obsidian.reloadPlugin();

  // Counted after the plugin has loaded again and Obsidian has finished
  // the tabs it kept.
  await expect.poll(async () => obsidian.tabs(NAVIGATOR)).toBe(1);
  await expect.poll(async () => obsidian.tabs(PANEL)).toBe(1);
  await expect(obsidian.ghosts()).toHaveCount(0);
  await expect(obsidian.view(NAVIGATOR)).toHaveCount(1);
  await expect(obsidian.view(PANEL)).toHaveCount(1);
});

// What this spec does not cover: the order of the tabs inside a sidebar
// that holds other plugins' tabs, and a tab the author closed before the
// reload, which comes back because orca opens both on every load.
