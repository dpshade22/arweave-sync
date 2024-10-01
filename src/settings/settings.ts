import { App, PluginSettingTab, Setting } from "obsidian";
import { ArweaveSyncSettings } from "../types";
import ArweaveSync from "../main";

export class ArweaveSyncSettingTab extends PluginSettingTab {
  plugin: ArweaveSync;

  constructor(app: App, plugin: ArweaveSync) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "ArweaveSync Settings" });

    new Setting(containerEl)
      .setName("Encryption Password")
      .setDesc("Set the encryption password for your synced files")
      .addText((text) =>
        text
          .setPlaceholder("Enter your password")
          .setValue(this.plugin.settings.encryptionPassword)
          .onChange(async (value) => {
            this.plugin.settings.encryptionPassword = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
