import { Modal, App, TFile } from "obsidian";
import ArweaveSync from "../main";
import { LogManager } from "../utils/logManager";

export class RemoteNewerVersionModal extends Modal {
  private result: "import" | "proceed" | null = null;
  private logger: LogManager;
  private resolvePromise: ((value: "import" | "proceed") => void) | null = null;

  constructor(
    app: App,
    private file: TFile,
    private plugin: ArweaveSync,
  ) {
    super(app);
    this.logger = new LogManager(plugin, "RemoteNewerVersionModal");
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
    if (this.resolvePromise) {
      this.logger.debug(`User choice: ${this.result || "proceed"}`);
      this.resolvePromise(this.result || "proceed");
    }
  }

  async awaitChoice(): Promise<"import" | "proceed"> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
  }
}
