import {
  Modal,
  App,
  TFile,
  MarkdownRenderer,
  Notice,
  ButtonComponent,
  setIcon,
} from "obsidian";
import ArweaveSync from "../main";

interface FileVersion {
  txId: string;
  content: string;
  timestamp: number;
  fileHash: string;
  versionNumber: number;
  previousVersionTxId: string | null;
}

export class FileHistoryModal extends Modal {
  private versions: FileVersion[] = [];
  private currentPage: number = 1;
  private versionsPerPage: number = 10;
  private selectedVersion: FileVersion | null = null;

  constructor(
    app: App,
    private plugin: ArweaveSync,
    private file: TFile,
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("file-history-modal");

    this.addStyle();

    const header = contentEl.createEl("div", { cls: "modal-header" });
    header.createEl("h2", {
      text: `File History: ${this.file.name}`,
      cls: "modal-title",
    });

    const closeButton = header.createEl("button", {
      cls: "modal-close-button",
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.close());

    const content = contentEl.createEl("div", { cls: "modal-content" });

    this.versions = await this.plugin.fetchFileVersions(this.file.path);
    await this.renderVersionList(content);
  }

  private addStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .modal-container.mod-dim .modal {
        width: auto;
      }
      .file-history-modal {
        max-width: 800px;
        width: 90vw;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        border-radius: 6px;
        box-shadow: 0 2px 8px var(--background-modifier-box-shadow);
        background-color: var(--background-primary);
        overflow: hidden;
      }
      .modal-header {
        padding: 16px;
        border-bottom: 1px solid var(--background-modifier-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .modal-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--text-normal);
      }
      .modal-close-button {
        background-color: transparent;
        border: none;
        cursor: pointer;
        padding: 4px;
        color: var(--text-muted);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .modal-close-button:hover {
        color: var(--text-normal);
      }
      .modal-content {
        flex-grow: 1;
        width: auto;
        overflow-y: auto;
        padding: 16px;
      }
      .version-list {
        list-style-type: none;
        padding: 0;
        margin: 0;
      }
      .version-list-item {
        padding: 8px 12px;
        border-radius: 4px;
        margin-bottom: 8px;
        background-color: var(--background-secondary);
        transition: background-color 0.2s ease;
      }
      .version-list-item:hover {
        background-color: var(--background-modifier-hover);
      }
      .version-link {
        color: var(--text-normal);
        text-decoration: none;
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pagination-container {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--background-modifier-border);
      }
      .version-info {
        background-color: var(--background-secondary);
        padding: 16px;
        border-radius: 4px;
        margin-bottom: 16px;
      }
      .version-info p {
        margin: 0 0 8px 0;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .version-info p:last-child {
        margin-bottom: 0;
      }
      .version-content {
        background-color: var(--background-primary);
        padding: 16px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        margin-top: 16px;
        white-space: pre-wrap;
        word-break: break-word;
        user-select: text;
        font-family: var(--font-monospace);
        font-size: 14px;
        line-height: 1.5;
        overflow-x: hidden;
      }
      .button-container {
        display: flex;
        justify-content: space-between;
        margin-top: 16px;
      }
      .back-button,
      .restore-button {
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.2s ease;
        cursor: pointer;
        border: none;
      }
      .back-button {
        background-color: var(--interactive-normal);
        color: var(--text-normal);
      }
      .back-button:hover {
        background-color: var(--interactive-hover);
      }
      .restore-button {
        color: var(--text-on-accent);
      }
      .restore-button:hover {
        background-color: var(--interactive-accent-hover);
      }
    `;
    document.head.appendChild(style);
  }

  async renderVersionList(container: HTMLElement) {
    container.empty();

    const versionList = container.createEl("ul", { cls: "version-list" });

    const startIndex = (this.currentPage - 1) * this.versionsPerPage;
    const endIndex = startIndex + this.versionsPerPage;
    const pageVersions = this.versions.slice(startIndex, endIndex);

    pageVersions.forEach((version) => {
      const listItem = versionList.createEl("li", { cls: "version-list-item" });
      const link = listItem.createEl("a", {
        cls: "version-link",
        href: "#",
        text: `${new Date(version.timestamp * 1000).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        })}`,
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.selectedVersion = version;
        this.showVersion(version, container);
      });
    });

    this.renderPagination(container);
  }

  private renderPagination(container: HTMLElement) {
    const paginationContainer = container.createEl("div", {
      cls: "pagination-container",
    });
    const totalPages = Math.ceil(this.versions.length / this.versionsPerPage);

    if (this.currentPage > 1) {
      new ButtonComponent(paginationContainer)
        .setButtonText("Previous")
        .onClick(() => {
          this.currentPage--;
          this.renderVersionList(container);
        });
    }

    paginationContainer.createSpan(`Page ${this.currentPage} of ${totalPages}`);

    if (this.currentPage < totalPages) {
      new ButtonComponent(paginationContainer)
        .setButtonText("Next")
        .onClick(() => {
          this.currentPage++;
          this.renderVersionList(container);
        });
    }
  }

  async showVersion(version: FileVersion, container: HTMLElement) {
    container.empty();

    const versionInfo = container.createEl("div", { cls: "version-info" });
    versionInfo.createEl("p", {
      text: `Date: ${new Date(version.timestamp * 1000).toLocaleString(
        "en-US",
        {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        },
      )}`,
    });
    if (version.previousVersionTxId) {
      versionInfo.createEl("p", {
        text: `Previous Version: ${version.previousVersionTxId}`,
      });
    }

    const contentContainer = container.createEl("div", {
      cls: "version-content",
    });
    await MarkdownRenderer.renderMarkdown(
      version.content,
      contentContainer,
      this.file.path,
      this.plugin,
    );

    const buttonContainer = container.createEl("div", {
      cls: "button-container",
    });
    new ButtonComponent(buttonContainer)
      .setButtonText("Back to Version List")
      .setClass("back-button")
      .onClick(() => this.renderVersionList(container));

    new ButtonComponent(buttonContainer)
      .setButtonText("Restore This Version")
      .setClass("restore-button")
      .onClick(() => this.restoreVersion(version));
  }

  async restoreVersion(version: FileVersion) {
    const confirmed = await this.plugin.confirmRestore(this.file.name);
    if (confirmed) {
      await this.app.vault.modify(this.file, version.content);
      new Notice(`Restored version ${version.txId} of ${this.file.name}`);
      this.close();
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
