import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import { settingDefinitions, type Limited, type SettingDefinition } from "@/ui/definitions";

/** Orca's tab in Obsidian's settings. */
export class OrcaSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly orca: Plugin & Limited,
  ) {
    super(app, orca);
  }

  /** Obsidian 1.13 draws the tab from these, and does not call `display`. */
  getSettingDefinitions(): SettingDefinition[] {
    return settingDefinitions(this.orca);
  }

  /** Draws the same rows on an Obsidian older than 1.13. */
  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const definition of this.getSettingDefinitions()) {
      definition.render(new Setting(containerEl).setName(definition.name).setDesc(definition.desc));
    }
  }
}
