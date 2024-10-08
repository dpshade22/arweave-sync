import {
  Modal,
  App,
  TFile,
  MarkdownRenderer,
  MarkdownRenderChild,
  ButtonComponent,
  Notice,
} from "obsidian";
import ArweaveSync from "../main";
import { FileVersion } from "../types";

export class FileHistoryModal extends Modal {
  private versions: FileVersion[] = [];
  private currentVersionIndex: number = 0;
  private navigationEl: HTMLElement;
  private versionInfoEl: HTMLElement;
  private loadingEl: HTMLElement;
  private isLoading: boolean = false;
  private hasMoreVersions: boolean = true;
  private modalContentEl: HTMLElement;
  private markdownContainer: HTMLElement;

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

    const header = contentEl.createEl("div", { cls: "modal-header" });
    header.createEl("h2", { text: "File history" });

    this.loadingEl = contentEl.createEl("div", { cls: "loading-container" });
    this.loadingEl.createEl("div", {
      cls: "loading-text",
      text: "Loading versions",
    });
    this.loadingEl.createEl("div", { cls: "loading-dots" });
    this.loadingEl.style.display = "none";

    this.modalContentEl = contentEl.createEl("div", { cls: "modal-content" });

    this.markdownContainer = this.modalContentEl.createEl("div", {
      cls: "rendered-markdown",
    });

    const bottomSection = this.modalContentEl.createEl("div", {
      cls: "bottom-section",
    });
    this.versionInfoEl = bottomSection.createEl("div", { cls: "version-info" });
    this.navigationEl = bottomSection.createEl("div", {
      cls: "button-container",
    });

    await this.loadInitialVersions();
    if (this.versions.length === 0) {
      this.modalContentEl.createEl("p", {
        text: "No version history available for this file.",
        cls: "error-message",
      });
      return;
    }

    await this.renderVersionContent();
    this.renderNavigationButtons();
  }

  private async loadInitialVersions() {
    this.setLoading(true);
    this.versions = await this.plugin.vaultSyncManager.fetchFileVersions(
      10,
      this.file.path,
    );
    this.setLoading(false);
    this.hasMoreVersions = this.versions.length === 10;
  }

  private async loadMoreVersions() {
    if (this.isLoading || !this.hasMoreVersions) return;

    this.setLoading(true);
    const oldestLoadedVersion = this.versions[this.versions.length - 1];
    const newVersions = await this.plugin.vaultSyncManager.fetchFileVersions(
      10,
      undefined,
      oldestLoadedVersion.txId,
    );

    if (newVersions.length > 0) {
      this.versions = [...this.versions, ...newVersions];
      this.hasMoreVersions = newVersions.length === 10;
    } else {
      this.hasMoreVersions = false;
    }

    this.setLoading(false);
  }

  private setLoading(loading: boolean) {
    this.isLoading = loading;
    this.loadingEl.style.display = loading ? "flex" : "none";
    this.modalContentEl.style.display = loading ? "none" : "flex";
  }

  private async renderVersionContent() {
    this.markdownContainer.empty();

    const currentVersion = this.versions[this.currentVersionIndex];
    await MarkdownRenderer.render(
      this.app,
      currentVersion.content,
      this.markdownContainer,
      this.file.path,
      new MarkdownRenderChild(this.markdownContainer),
    );

    this.updateVersionInfo();
  }

  private updateVersionInfo() {
    this.versionInfoEl.empty();
    const currentVersion = this.versions[this.currentVersionIndex];
    this.versionInfoEl.createEl("p", {
      text: `File: ${this.file.name.replace(/\.md$/, "")}`,
    });
    this.versionInfoEl.createEl("p", {
      text: `Date: ${new Date(currentVersion.timestamp * 1000).toLocaleString()}`,
    });
    this.versionInfoEl.createEl("p", {
      text: `TxID: ${currentVersion.txId}`,
    });
  }

  private renderNavigationButtons() {
    this.navigationEl.empty();

    const prevButton = new ButtonComponent(this.navigationEl)
      .setButtonText(
        this.currentVersionIndex === this.versions.length - 1 &&
          this.hasMoreVersions
          ? "Fetch More"
          : "Previous Version",
      )
      .onClick(() => {
        if (
          this.currentVersionIndex === this.versions.length - 1 &&
          this.hasMoreVersions
        ) {
          this.loadMoreVersions().then(() => this.renderNavigationButtons());
        } else {
          this.navigateVersion("previous");
        }
      });
    prevButton.buttonEl.disabled =
      this.isLoading ||
      (this.currentVersionIndex === this.versions.length - 1 &&
        !this.hasMoreVersions);

    const nextButton = new ButtonComponent(this.navigationEl)
      .setButtonText("Next Version")
      .onClick(() => this.navigateVersion("next"));
    nextButton.buttonEl.disabled = this.currentVersionIndex === 0;

    new ButtonComponent(this.navigationEl)
      .setButtonText("Restore This Version")
      .setCta()
      .onClick(() => this.restoreVersion())
      .buttonEl.classList.add("restore-button");
  }

  private async navigateVersion(direction: "previous" | "next") {
    if (direction === "previous") {
      if (
        this.currentVersionIndex === this.versions.length - 1 &&
        this.hasMoreVersions
      ) {
        await this.loadMoreVersions();
      }
      if (this.currentVersionIndex < this.versions.length - 1) {
        this.currentVersionIndex++;
      }
    } else if (direction === "next" && this.currentVersionIndex > 0) {
      this.currentVersionIndex--;
    }

    await this.renderVersionContent();
    this.renderNavigationButtons();
  }

  private async restoreVersion() {
    const currentVersion = this.versions[this.currentVersionIndex];
    const confirmed = await this.plugin.confirmRestore(this.file.name);
    if (confirmed) {
      await this.app.vault.modify(this.file, currentVersion.content);
      new Notice(
        `Restored version of ${this.file.name} from ${new Date(currentVersion.timestamp * 1000).toLocaleString()}`,
      );
      this.close();
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
