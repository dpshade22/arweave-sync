import { App, Modal, TFile } from "obsidian";
import ArweaveSync from "../main";
import { FileUploadInfo } from "../types";

interface VersionInfo {
  versionNumber: number;
  timestamp: number;
  formattedDate: string;
}

export class PreviousVersionModal extends Modal {
  plugin: ArweaveSync;
  file: TFile;
  versionNumber: number = 1;
  versionHistory: VersionInfo[] = [];

  constructor(app: App, plugin: ArweaveSync, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("previous-version-modal");

    contentEl.createEl("h2", { text: "Open Previous Version" });

    await this.loadVersionHistory();
    this.renderVersionList();

    const versionContainer = contentEl.createDiv({ cls: "version-container" });

    const description = versionContainer.createEl("span", {
      text: "Enter the number of versions back:",
      cls: "version-description",
    });

    versionContainer.createEl("br");

    const versionInput = versionContainer.createEl("input", {
      type: "number",
      value: "1",
      cls: "version-input",
    });
    versionInput.style.width = "50px";
    versionInput.style.marginLeft = "1rem";
    versionInput.addEventListener("change", (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      if (value > 0) {
        this.versionNumber = value;
      } else {
        (e.target as HTMLInputElement).value = "1";
        this.versionNumber = 1;
      }
    });

    const buttonContainer = contentEl.createDiv({ cls: "button-container" });

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());

    const submitButton = buttonContainer.createEl("button", {
      text: "Open Version",
      cls: "mod-cta",
    });
    submitButton.addEventListener("click", async () => {
      this.close();
      await this.plugin.openPreviousVersion(this.file, this.versionNumber);
    });
  }

  async loadVersionHistory() {
    const fileInfo = this.plugin.settings.localUploadConfig[this.file.path];
    if (!fileInfo) return;

    let currentVersion = fileInfo;
    for (let i = 0; i < 6 && currentVersion; i++) {
      const previousVersionInfo = await this.plugin.fetchPreviousVersion(
        this.file.path,
        i,
        { [this.file.path]: fileInfo },
      );

      if (!previousVersionInfo) break;

      this.versionHistory.push({
        versionNumber: fileInfo.versionNumber - i,
        timestamp: previousVersionInfo.timestamp,
        formattedDate: new Date(
          previousVersionInfo.timestamp * 1000,
        ).toLocaleString(),
      });

      if (!currentVersion.previousVersionTxId) break;
    }
  }

  renderVersionList() {
    const { contentEl } = this;
    const listContainer = contentEl.createDiv({
      cls: "version-list-container",
    });
    const listEl = listContainer.createEl("ul", { cls: "version-list" });

    this.versionHistory.forEach((version, index) => {
      const listItem = listEl.createEl("li", { cls: "version-list-item" });
      const itemContent = listItem.createEl("div", {
        cls: "version-item-content",
      });

      itemContent.createEl("span", {
        text: version.formattedDate,
        cls: "version-date",
      });

      itemContent.createEl("span", {
        text: `Version ${version.versionNumber}`,
        cls: "version-number",
      });

      listItem.addEventListener("click", () => {
        this.versionNumber = index + 1;
        const versionInput = contentEl.querySelector(
          ".version-input",
        ) as HTMLInputElement;
        if (versionInput) {
          versionInput.value = this.versionNumber.toString();
        }
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
