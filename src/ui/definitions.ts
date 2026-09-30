import type { Setting } from "obsidian";
import { DEEPEST_LEVEL, MOST_SESSIONS, isPageUnit, type Limits } from "@/ui/limits";

/** The plugin, narrowed to the settings orca's tab writes. */
export interface Limited {
  readonly limits: Limits;
  /** Saves the limits, and applies them to the engines that already run. */
  limit(limits: Limits): void;
}

/**
 * One row of Obsidian's declarative settings, which 1.13 draws and
 * indexes for settings search. The pinned typings are older than it,
 * so this is the part of its shape orca uses. Obsidian sets the name
 * and the description on the row before it calls `render`.
 */
export interface SettingDefinition {
  name: string;
  desc: string;
  render: (setting: Setting) => void;
}

/** Orca's settings, one definition to a row, in the order the tab shows them. */
export function settingDefinitions(orca: Limited): SettingDefinition[] {
  let levels: Setting | undefined;
  return [
    {
      name: "Page measurements",
      desc: "The unit for margins and custom trim sizes.",
      render: (setting) => {
        setting.addDropdown((dropdown) =>
          dropdown
            .addOptions({ in: "Inches", mm: "Millimeters", pt: "Points" })
            .setValue(orca.limits.unit)
            .onChange((unit) => {
              if (isPageUnit(unit)) orca.limit({ ...orca.limits, unit });
            }),
        );
      },
    },
    {
      name: "Headings in the navigator",
      desc: "Show each note's headings in the navigator.",
      render: (setting) => {
        setting.addToggle((toggle) =>
          toggle.setValue(orca.limits.headings).onChange((headings) => {
            orca.limit({ ...orca.limits, headings });
            levels?.setDisabled(!headings);
          }),
        );
      },
    },
    {
      name: "Heading levels in the navigator",
      desc: "List the headings down to this level.",
      render: (setting) => {
        levels = setting
          .addSlider((slider) =>
            slider
              .setLimits(1, DEEPEST_LEVEL, 1)
              .setValue(orca.limits.deepest)
              .setDynamicTooltip()
              .onChange((deepest) => {
                orca.limit({ ...orca.limits, deepest });
              }),
          )
          .setDisabled(!orca.limits.headings);
      },
    },
    {
      name: "Open previews at once",
      desc: "How many book previews Orca keeps open at the same time.",
      render: (setting) => {
        setting.addSlider((slider) =>
          slider
            .setLimits(1, MOST_SESSIONS, 1)
            .setValue(orca.limits.sessions)
            .setDynamicTooltip()
            .onChange((sessions) => {
              orca.limit({ ...orca.limits, sessions });
            }),
        );
      },
    },
  ];
}
