import { NAVIGATOR } from "./harness/navigator";
import { PANEL } from "./harness/panel";
import { expect, test } from "./harness/test";

test("reloading the plugin leaves one navigator and one design panel", async ({
  obsidian,
}) => {
  // The panel fixture closes the panel after every spec, so this one
  // opens both where a startup puts them.
  await obsidian.page.evaluate(
    async ({ navigator, panel }) => {
      await window.app.workspace.ensureSideLeaf(navigator, "left", { reveal: false });
      await window.app.workspace.ensureSideLeaf(panel, "right", { reveal: false });
    },
    { navigator: NAVIGATOR, panel: PANEL },
  );
  await expect.poll(async () => obsidian.tabs(NAVIGATOR)).toBe(1);
  await expect.poll(async () => obsidian.tabs(PANEL)).toBe(1);

  await obsidian.reloadPlugin();

  // Counted after the plugin has loaded again and Obsidian has finished
  // the tabs it kept.
  await expect.poll(async () => obsidian.tabs(NAVIGATOR)).toBe(1);
  await expect.poll(async () => obsidian.tabs(PANEL)).toBe(1);
  for (const type of [NAVIGATOR, PANEL]) {
    const titles = await obsidian.titles(type);
    expect(titles).toHaveLength(1);
    expect(titles[0]).not.toBe(type);
  }
});

// What this spec does not cover: the order of the tabs inside a sidebar
// that holds other plugins' tabs, and a tab the author closed before the
// reload, which comes back because orca opens both on every load.
