import { App, Modal, Setting, TFile } from "obsidian";
import ArweaveSync from "../main";

export class PreviousVersionModal extends Modal {
  plugin: ArweaveSync;
  file: TFile;
  versionNumber: number = 1;

  constructor(app: App, plugin: ArweaveSync, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("previous-version-modal");

    contentEl.createEl("h2", { text: "Open Previous Version" });

    const versionContainer = contentEl.createDiv({ cls: "version-container" });

    const description = versionContainer.createEl("span", {
      text: "Enter the number of versions back:",
      cls: "version-description",
    });

    versionContainer.createEl("br"); // Add a line break for gap

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

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
