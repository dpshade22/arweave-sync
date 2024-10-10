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

    new Setting(containerEl)
      .setName("Monthly Arweave Spend Limit")
      .setDesc("Set the maximum amount of AR tokens to spend per month")
      .addText((text) =>
        text
          .setPlaceholder("0.2")
          .setValue(this.plugin.settings.monthlyArweaveSpendLimit.toString())
          .onChange(async (value) => {
            const numValue = parseFloat(value);
            if (!isNaN(numValue) && numValue >= 0) {
              this.plugin.settings.monthlyArweaveSpendLimit = numValue;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Monthly Files Synced")
      .setDesc("Number of files synced this month")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.monthlyFilesSynced.toString())
          .setDisabled(true),
      );

    new Setting(containerEl)
      .setName("Current Month Spend")
      .setDesc("Amount of AR tokens spent this month")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.currentMonthSpend.toFixed(6))
          .setDisabled(true),
      );

    new Setting(containerEl)
      .setName("Reset Monthly Counters")
      .setDesc("Reset the monthly files synced and spend counters")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          this.plugin.settings.monthlyFilesSynced = 0;
          this.plugin.settings.currentMonthSpend = 0;
          this.plugin.settings.monthlyResetDate = Date.now();
          await this.plugin.saveSettings();
          this.display(); // Refresh the settings display
        }),
      );

    new Setting(containerEl)
      .setName("Lifetime Files Synced")
      .setDesc("Total number of files synced")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.lifetimeFilesSynced.toString())
          .setDisabled(true),
      );
  }
}
