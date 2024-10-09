import { App, Modal, MarkdownRenderer, MarkdownRenderChild } from "obsidian";
import ArweaveSync from "../main";

export class RemoteFilePreviewModal extends Modal {
  private loadingEl: HTMLElement;
  public contentEl: HTMLElement;

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

    const header = contentEl.createEl("div", { cls: "modal-header custom" });
    header.createEl("h2", { text: "Remote file preview" });

    this.loadingEl = contentEl.createEl("div", { cls: "loading-container" });
    this.loadingEl.createEl("div", {
      cls: "loading-text",
      text: "Loading file content",
    });
    this.loadingEl.createEl("div", { cls: "loading-dots" });

    this.contentEl = contentEl.createEl("div", { cls: "modal-content custom" });
    this.contentEl.style.display = "none";

    await this.loadFileContent();
  }

  private async loadFileContent() {
    try {
      const fileName = this.filePath.split("/").pop() || this.filePath;
      this.contentEl.createEl("h1", {
        text: fileName,
        cls: "file-name-heading",
      });

      const fileContent =
        await this.plugin.vaultSyncManager.fetchLatestRemoteFileContent(
          this.filePath,
        );

      // Create a container for the code block-like appearance
      const codeBlockContainer = this.contentEl.createEl("div", {
        cls: "code-block-container",
      });

      // Create a div for the rendered markdown
      const markdownContainer = codeBlockContainer.createEl("div", {
        cls: "rendered-markdown",
      });

      await MarkdownRenderer.render(
        this.app,
        fileContent,
        markdownContainer,
        this.filePath,
        new MarkdownRenderChild(markdownContainer),
      );

      this.loadingEl.style.display = "none";
      this.contentEl.style.display = "block";
    } catch (error) {
      this.loadingEl.style.display = "none";
      this.contentEl.style.display = "block";
      this.contentEl.createEl("p", {
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
