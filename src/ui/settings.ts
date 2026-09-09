import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import { MOST_BOOKS, type Limits } from "@/ui/limits";

/** The plugin, narrowed to the settings this tab writes. */
export interface Limited {
  readonly limits: Limits;
  /** Saves the limits and applies them to the engines already running. */
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
      .setName("Books kept on the engine")
      .setDesc(
        "A book stays typeset after its last pane closes, so opening it " +
          "again does not lay it out a second time. Each book kept this " +
          "way runs a worker that holds the whole book.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, MOST_BOOKS, 1)
          .setValue(this.orca.limits.books)
          .setDynamicTooltip()
          .onChange((books) => {
            this.orca.limit({ ...this.orca.limits, books });
          }),
      );
  }
}
