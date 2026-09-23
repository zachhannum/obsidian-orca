import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import { MOST_SESSIONS, isPageUnit, type Limits } from "@/ui/limits";

/** The plugin, narrowed to the settings this tab writes. */
export interface Limited {
  readonly limits: Limits;
  /** Saves the limits, and applies them to the engines that already run. */
  limit(limits: Limits): void;
}

/** Orca's tab in Obsidian's settings. */
export class OrcaSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly orca: Plugin & Limited,
  ) {
    super(app, orca);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Page measurements")
      .setDesc("The unit the design panel shows margins and a custom trim in.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ in: "Inches", mm: "Millimeters", pt: "Points" })
          .setValue(this.orca.limits.unit)
          .onChange((unit) => {
            if (isPageUnit(unit)) this.orca.limit({ ...this.orca.limits, unit });
          }),
      );
    new Setting(containerEl)
      .setName("Max concurrent preview sessions")
      .setDesc(
        "The most books orca keeps typeset at once, so one opens again " +
          "without a wait.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, MOST_SESSIONS, 1)
          .setValue(this.orca.limits.sessions)
          .setDynamicTooltip()
          .onChange((sessions) => {
            this.orca.limit({ ...this.orca.limits, sessions });
          }),
      );
  }
}
