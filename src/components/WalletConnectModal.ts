import { App, Modal, Notice } from "obsidian";
import { walletManager } from "../managers/walletManager";
import { JWKInterface } from "arweave/node/lib/wallet";
import Arweave from "arweave";
import ArweaveSync from "../main";

export class WalletConnectModal extends Modal {
  private dragArea: HTMLDivElement;
  private plugin: ArweaveSync;

  constructor(app: App, plugin: ArweaveSync) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Connect Your Wallet" });
    contentEl.createEl("p", {
      text: "Drag and drop your wallet JSON file here to connect.",
    });

    this.dragArea = contentEl.createEl("div", { cls: "wallet-drag-area" });
    this.dragArea.setText("Drag & Drop Wallet File Here");

    this.setupDragAndDrop();
  }

  setupDragAndDrop() {
    const preventDefault = (e: Event) => e.preventDefault();

    this.dragArea.addEventListener("dragenter", preventDefault);
    this.dragArea.addEventListener("dragover", preventDefault);
    this.dragArea.addEventListener("dragleave", () => {
      this.dragArea.removeClass("drag-active");
    });

    this.dragArea.addEventListener("dragenter", () => {
      this.dragArea.addClass("drag-active");
    });

    this.dragArea.addEventListener("drop", (e) => {
      e.preventDefault();
      this.dragArea.removeClass("drag-active");

      const file = e.dataTransfer?.files[0];
      if (file) {
        this.handleFileUpload(file);
      }
    });

    // Also allow clicking to select file
    this.dragArea.addEventListener("click", () => {
      const input = createEl("input", {
        attr: { type: "file", accept: ".json" },
      });
      input.onchange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          this.handleFileUpload(file);
        }
      };
      input.click();
    });
  }

  async handleFileUpload(file: File) {
    try {
      const fileContent = await file.text();
      const jwk = JSON.parse(fileContent) as JWKInterface;
      this.close();
      await this.plugin.handleWalletConnection(jwk);
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      new Notice("Failed to connect wallet. Please try again.");
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
