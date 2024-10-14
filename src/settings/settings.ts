import { App, PluginSettingTab, Setting, TextComponent } from "obsidian";
import { ArweaveSyncSettings } from "../types";
import ArweaveSync from "../main";

export class ArweaveSyncSettingTab extends PluginSettingTab {
  plugin: ArweaveSync;
  private folderInputEl: TextComponent;

  constructor(app: App, plugin: ArweaveSync) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "ArweaveSync settings" });

    new Setting(containerEl)
      .setName("Full automatic sync")
      .setDesc("Enable full automatic bidirectional synchronization")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.fullAutoSync)
          .onChange(async (value) => {
            this.plugin.settings.fullAutoSync = value;
            if (value) {
              this.plugin.settings.syncDirection = "bidirectional";
              this.plugin.settings.syncOnStartup = true;
              this.plugin.settings.syncOnFileChange = true;
              this.plugin.settings.autoImportUnsyncedChanges = false;
              this.plugin.settings.autoExportOnIdle = false;
              this.plugin.settings.autoExportOnClose = false;
            }
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.fullAutoSync) {
      new Setting(containerEl)
        .setName("Sync interval")
        .setDesc("Time in minutes between automatic syncs")
        .addSlider((slider) =>
          slider
            .setLimits(1, 60, 1)
            .setValue(this.plugin.settings.syncInterval)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.syncInterval = value;
              await this.plugin.saveSettings();
            }),
        );
    } else {
      // new Setting(containerEl)
      //   .setName("Sync on startup")
      //   .setDesc("Automatically sync when Obsidian starts")
      //   .addToggle((toggle) =>
      //     toggle
      //       .setValue(this.plugin.settings.syncOnStartup)
      //       .onChange(async (value) => {
      //         this.plugin.settings.syncOnStartup = value;
      //         await this.plugin.saveSettings();
      //       }),
      //   );

      new Setting(containerEl)
        .setName("Sync direction")
        .setDesc("Choose the direction of synchronization")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("bidirectional", "Bidirectional")
            .addOption("uploadOnly", "Upload only")
            .addOption("downloadOnly", "Download only")
            .setValue(this.plugin.settings.syncDirection)
            .onChange(async (value) => {
              this.plugin.settings.syncDirection = value as
                | "bidirectional"
                | "uploadOnly"
                | "downloadOnly";
              if (value === "uploadOnly") {
                this.plugin.settings.autoImportUnsyncedChanges = false;
              } else if (value === "downloadOnly") {
                this.plugin.settings.autoExportOnIdle = false;
                this.plugin.settings.autoExportOnClose = false;
              }
              await this.plugin.saveSettings();
              this.display();
            }),
        );

      new Setting(containerEl).setName("Sync behavior").setHeading();

      if (this.plugin.settings.syncDirection !== "uploadOnly") {
        new Setting(containerEl)
          .setName("Auto-import unsynced changes")
          .setDesc(
            "Automatically import unsynced changes when connecting wallet",
          )
          .addToggle((toggle) =>
            toggle
              .setValue(this.plugin.settings.autoImportUnsyncedChanges)
              .onChange(async (value) => {
                this.plugin.settings.autoImportUnsyncedChanges = value;
                await this.plugin.saveSettings();
              }),
          );
      }

      if (this.plugin.settings.syncDirection !== "downloadOnly") {
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
                this.display();
              }),
          );

        // new Setting(containerEl)
        //   .setName("Auto-export on file close")
        //   .setDesc("Automatically export files when they are closed")
        //   .addToggle((toggle) =>
        //     toggle
        //       .setValue(this.plugin.settings.autoExportOnClose)
        //       .onChange(async (value) => {
        //         this.plugin.settings.autoExportOnClose = value;
        //         await this.plugin.saveSettings();
        //       }),
        //   );

        if (this.plugin.settings.autoExportOnIdle) {
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
        }
      }
    }

    new Setting(containerEl)
      .setName("Files to sync")
      .setDesc("Choose which files to sync")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("all", "All files")
          .addOption("selected", "Selected folders")
          .setValue(this.plugin.settings.filesToSync)
          .onChange(async (value) => {
            this.plugin.settings.filesToSync = value as "all" | "selected";
            await this.plugin.saveSettings();
            this.display(); // Refresh the settings display
          }),
      );

    if (this.plugin.settings.filesToSync === "selected") {
      new Setting(containerEl)
        .setName("Selected folders to sync")
        .setDesc("Enter folder paths to sync, separated by commas")
        .addText((text) => {
          this.folderInputEl = text;
          text
            .setPlaceholder("folder1, folder2/subfolder, folder3")
            .setValue(this.plugin.settings.selectedFoldersToSync.join(", "))
            .onChange(async (value) => {
              this.plugin.settings.selectedFoldersToSync = value
                .split(",")
                .map((folder) => folder.trim());
              await this.plugin.saveSettings();
            });
        });
    }

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("Enter folder paths to exclude from sync, separated by commas")
      .addText((text) =>
        text
          .setPlaceholder("folder1, folder2/subfolder, folder3")
          .setValue(this.plugin.settings.excludedFolders.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value
              .split(",")
              .map((folder) => folder.trim());
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("File types to sync")
      .setDesc("Enter file extensions to sync, separated by commas")
      .addText((text) =>
        text
          .setPlaceholder(".md, .txt, .png, .jpg, .pdf")
          .setValue(this.plugin.settings.syncFileTypes.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.syncFileTypes = value
              .split(",")
              .map((ext) => ext.trim());
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Cost management").setHeading();

    new Setting(containerEl)
      .setName("Monthly Arweave spend limit")
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
      .setName("Monthly files synced")
      .setDesc("Number of files synced this month")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.monthlyFilesSynced.toString())
          .setDisabled(true),
      );

    new Setting(containerEl)
      .setName("Current month spend")
      .setDesc("Amount of AR tokens spent this month")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.currentMonthSpend.toFixed(6))
          .setDisabled(true),
      );

    new Setting(containerEl)
      .setName("Reset monthly counters")
      .setDesc("Reset the monthly files synced and spend counters")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          this.plugin.settings.monthlyFilesSynced = 0;
          this.plugin.settings.currentMonthSpend = 0;
          this.plugin.settings.monthlyResetDate = Date.now();
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl).setName("Usage statistics").setHeading();

    new Setting(containerEl)
      .setName("Lifetime files synced")
      .setDesc("Total number of files synced")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.lifetimeFilesSynced.toString())
          .setDisabled(true),
      );

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("Enable debug logging (may impact performance)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
