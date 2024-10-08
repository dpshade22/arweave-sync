import { App, Modal, MarkdownRenderer, MarkdownRenderChild } from "obsidian";
import ArweaveSync from "../main";

export class RemoteFilePreviewModal extends Modal {
  constructor(
    app: App,
    private plugin: ArweaveSync,
    private filePath: string,
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("remote-file-preview-modal");

    const header = contentEl.createEl("div", { cls: "modal-header" });
    header.createEl("h2", { text: "Remote File Preview" });

    const content = contentEl.createEl("div", { cls: "modal-content" });

    try {
      const fileName = this.filePath.split("/").pop() || this.filePath;
      content.createEl("h1", { text: fileName, cls: "file-name-heading" });

      const fileContent =
        await this.plugin.vaultSyncManager.fetchLatestRemoteFileContent(
          this.filePath,
        );

      const markdownContainer = content.createDiv();
      await MarkdownRenderer.render(
        this.app,
        fileContent,
        markdownContainer,
        this.filePath,
        new MarkdownRenderChild(markdownContainer),
      );
    } catch (error) {
      content.createEl("p", {
        text: `Error loading remote file: ${error.message}`,
        cls: "error-message",
      });
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
