import { Modal, App, TFile, Editor } from "obsidian";
import ArweaveSync from "../main";

export class RemoteNewerVersionModal extends Modal {
  private result: "import" | "proceed" | null = null;

  constructor(
    app: App,
    private file: TFile,
    private plugin: ArweaveSync,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Newer Remote Version Available" });
    contentEl.createEl("p", {
      text: `The file "${this.file.name}" has a newer version on Arweave. What would you like to do?`,
    });

    const buttonContainer = contentEl.createDiv("button-container");

    const importButton = buttonContainer.createEl("button", {
      text: "Import Remote Changes",
    });
    importButton.addEventListener("click", () => {
      this.result = "import";
      this.close();
    });

    const proceedButton = buttonContainer.createEl("button", {
      text: "Proceed with Local Edit",
    });
    proceedButton.addEventListener("click", () => {
      this.result = "proceed";
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  async awaitChoice(): Promise<"import" | "proceed"> {
    return new Promise((resolve) => {
      this.plugin.app.workspace.on("modal-close", () => {
        resolve(this.result || "proceed");
      });
    });
  }
}
