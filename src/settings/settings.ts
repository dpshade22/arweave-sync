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

    // new Setting(containerEl)
    //   .setName("Encryption Password")
    //   .setDesc("Set the encryption password for your synced files")
    //   .addText((text) =>
    //     text
    //       .setPlaceholder("Enter your password")
    //       .setValue(this.plugin.settings.encryptionPassword)
    //       .onChange(async (value) => {
    //         this.plugin.settings.encryptionPassword = value;
    //         await this.plugin.saveSettings();
    //       }),
    //   );

    new Setting(containerEl)
      .setName("Auto-import Unsynced Changes")
      .setDesc("Automatically import unsynced changes when connecting wallet")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoImportUnsyncedChanges)
          .onChange(async (value) => {
            this.plugin.settings.autoImportUnsyncedChanges = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto-export on idle")
      .setDesc("Automatically export files when the user is idle")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoExportOnIdle)
          .onChange(async (value) => {
            this.plugin.settings.autoExportOnIdle = value;
            await this.plugin.saveSettings();
            if (value) {
              this.plugin.startIdleTimer();
            } else {
              this.plugin.stopIdleTimer();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Auto-export on file close")
      .setDesc("Automatically export files when they are closed")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoExportOnClose)
          .onChange(async (value) => {
            this.plugin.settings.autoExportOnClose = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Idle time for auto-export")
      .setDesc("Time in minutes before auto-export triggers")
      .addSlider((slider) =>
        slider
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.idleTimeForAutoExport)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.idleTimeForAutoExport = value;
            await this.plugin.saveSettings();
            if (this.plugin.settings.autoExportOnIdle) {
              this.plugin.restartIdleTimer();
            }
          }),
      );

    // new Setting(containerEl)
    //   .setName("Custom Process ID")
    //   .setDesc("Optionally provide a custom AO process ID")
    //   .addText((text) =>
    //     text
    //       .setPlaceholder("Enter custom process ID")
    //       .setValue(this.plugin.settings.customProcessId)
    //       .onChange(async (value) => {
    //         this.plugin.settings.customProcessId = value;
    //         await this.plugin.saveSettings();
    //         // Reinitialize AOManager with new process ID
    //         await this.plugin.reinitializeAOManager();
    //       }),
    //   );
  }
}
