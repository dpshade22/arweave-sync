import {
  Plugin,
  TFile,
  MarkdownView,
  Notice,
  App,
  WorkspaceLeaf,
  TFolder,
} from "obsidian";
import { ArweaveUploader } from "./managers/arweaveUploader";
import { AOManager } from "./managers/aoManager";
import { ArPublishManager } from "./managers/arPublishManager";
import {
  initializeWalletManager,
  walletManager,
} from "./managers/walletManager";
import { VaultImportManager } from "./managers/vaultImportManager";
import {
  UploadConfig,
  FileUploadInfo,
  ArweaveSyncSettings,
  DEFAULT_SETTINGS,
} from "./types";
import { WalletConnectModal } from "./components/WalletConnectModal";
import Arweave from "arweave";
import { ArweaveSyncSettingTab } from "./settings/settings";
import { encrypt, decrypt } from "./utils/encryption";
import { debounce } from "./utils/helpers";
import { SyncSidebar, SYNC_SIDEBAR_VIEW } from "./components/SyncSidebar";
import * as CryptoJS from "crypto-js";
import "buffer";
import "process";
import "./styles.css";

const WALLET_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"></path><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"></path></svg>`;

export default class ArweaveSync extends Plugin {
  settings: ArweaveSyncSettings;
  private arweaveUploader: ArweaveUploader;
  private aoManager: AOManager;
  private vaultImportManager: VaultImportManager;
  private arPublishManager: ArPublishManager;
  private arweave: Arweave;
  private walletAddress: string | null = null;
  private statusBarItem: HTMLElement;
  private modifiedFiles: Set<string> = new Set();
  private activeSyncSidebar: SyncSidebar | null = null;

  async onload() {
    await this.loadSettings();
    this.initializeManagers();
    this.setupEventListeners();
    this.setupUI();
    this.addCommands();

    this.registerView(SYNC_SIDEBAR_VIEW, (leaf) => new SyncSidebar(leaf, this));

    this.addRibbonIcon("wallet", "Arweave Sync", (evt: MouseEvent) => {
      if (this.walletAddress) {
        this.activateSyncSidebar();
      } else {
        this.showWalletConnectModal();
      }
    });

    // this.arPublishManager = new ArPublishManager(this.app, this);

    // this.registerEvent(
    //   this.app.workspace.on("file-menu", (menu, file) => {
    //     if (file instanceof TFolder) {
    //       menu.addItem((item) => {
    //         item
    //           .setTitle("Publish to ArPublish")
    //           .setIcon("upload-cloud")
    //           .onClick(async () => {
    //             try {
    //               await this.arPublishManager.publishFolder(file);
    //               new Notice(`Folder "${file.name}" published successfully!`);
    //             } catch (error) {
    //               console.error("Error publishing folder:", error);
    //               new Notice(`Error publishing folder: ${error.message}`);
    //             }
    //           });
    //       });
    //     }
    //   }),
    // );
  }

  private initializeManagers() {
    this.arweaveUploader = new ArweaveUploader();
    this.aoManager = new AOManager();
    this.arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });
    this.vaultImportManager = new VaultImportManager(
      this.app.vault,
      this.settings.encryptionPassword,
      this.settings.remoteUploadConfig,
    );
    initializeWalletManager();
  }

  private setupEventListeners() {
    if (walletManager.isWalletLoaded()) {
      const cachedWalletJson = walletManager.getWalletJson();
      if (cachedWalletJson) {
        this.handleWalletConnection(cachedWalletJson);
      }
    }

    walletManager.on(
      "wallet-connected",
      this.handleWalletConnection.bind(this),
    );
    walletManager.on(
      "wallet-disconnected",
      this.handleWalletDisconnection.bind(this),
    );

    this.registerFileEvents();
  }

  private registerFileEvents() {
    this.registerEvent(
      this.app.vault.on("modify", this.handleFileModify.bind(this)),
    );
    this.registerEvent(
      this.app.vault.on("rename", this.handleFileRename.bind(this)),
    );
    this.registerEvent(
      this.app.vault.on("delete", this.handleFileDelete.bind(this)),
    );
  }

  private setupUI() {
    this.createStatusBarItem();
    this.setupSyncButton();
    this.addSettingTab(new ArweaveSyncSettingTab(this.app, this));
    this.addWalletIconToHeader();
  }

  private addWalletIconToHeader() {
    const headerEl = this.app.workspace.containerEl.querySelector(
      ".workspace-tab-header-container",
    );
    if (headerEl) {
      const walletIconEl = headerEl.createEl("div", {
        cls: "workspace-tab-header-inner arweave-wallet-icon",
        attr: { "aria-label": "Arweave Sync" },
      });
      walletIconEl.innerHTML = WALLET_ICON;
      walletIconEl.addEventListener(
        "click",
        this.handleWalletIconClick.bind(this),
      );
    }
  }

  private handleWalletIconClick() {
    if (this.walletAddress) {
      this.toggleSyncSidebar();
    } else {
      this.showWalletConnectModal();
    }
  }
  private toggleSyncSidebar() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SYNC_SIDEBAR_VIEW)[0];

    if (leaf) {
      workspace.detachLeavesOfType(SYNC_SIDEBAR_VIEW);
    } else {
      this.activateSyncSidebar();
    }
  }

  private setupSyncButton() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file: TFile) => {
        menu.addItem((item) => {
          item
            .setTitle("Sync with Arweave")
            .setIcon("sync")
            .onClick(() => this.syncFile(file));
        });
      }),
    );

    const debouncedAddSyncButtonToLeaf = debounce(
      this.addSyncButtonToLeaf.bind(this),
      100,
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", debouncedAddSyncButtonToLeaf),
    );
  }

  private addCommands() {
    this.addCommand({
      id: "open-arweave-sync-sidebar",
      name: "Open Arweave Sync Sidebar",
      callback: () => this.activateSyncSidebar(),
    });

    // Add new command for opening wallet connect modal
    this.addCommand({
      id: "open-wallet-connect-modal",
      name: "Connect Arweave Wallet",
      callback: () => this.showWalletConnectModal(),
    });
  }

  public getArweave() {
    return this.arweave;
  }

  public getWalletAddress() {
    return this.walletAddress;
  }

  private showWalletConnectModal() {
    new WalletConnectModal(this.app, this).open();
  }

  private createStatusBarItem() {
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass("arweave-wallet-status");
    this.updateStatusBar();
  }

  private updateStatusBar() {
    this.statusBarItem.empty();
    this.walletAddress
      ? this.createConnectedWalletStatus()
      : this.statusBarItem.setText("Arweave Wallet: Not Connected");
  }

  private createConnectedWalletStatus() {
    const slicedAddress = `${this.walletAddress!.slice(0, 6)}...${this.walletAddress!.slice(-4)}`;
    this.statusBarItem.appendChild(this.createAddressElement(slicedAddress));
    this.statusBarItem.appendChild(this.createDisconnectButton());
  }

  private createAddressElement(slicedAddress: string) {
    const addressEl = document.createElement("span");
    addressEl.textContent = slicedAddress;
    addressEl.addClass("arweave-wallet-address");
    addressEl.setAttribute("title", "Click to copy full address");
    addressEl.addEventListener("click", this.copyWalletAddress.bind(this));
    return addressEl;
  }

  private createDisconnectButton() {
    const disconnectButton = document.createElement("span");
    disconnectButton.addClass("arweave-wallet-disconnect");
    disconnectButton.setAttribute("title", "Disconnect wallet");
    disconnectButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2,5.27L3.28,4L20,20.72L18.73,22L13.9,17.17L11.29,19.78C9.34,21.73 6.17,21.73 4.22,19.78C2.27,17.83 2.27,14.66 4.22,12.71L5.71,11.22C5.7,12.04 5.83,12.86 6.11,13.65L5.64,14.12C4.46,15.29 4.46,17.19 5.64,18.36C6.81,19.54 8.71,19.54 9.88,18.36L12.5,15.76L10.88,14.15C10.87,14.39 10.77,14.64 10.59,14.83C10.2,15.22 9.56,15.22 9.17,14.83C8.12,13.77 7.63,12.37 7.72,11L2,5.27M12.71,4.22C14.66,2.27 17.83,2.27 19.78,4.22C21.73,6.17 21.73,9.34 19.78,11.29L18.29,12.78C18.3,11.96 18.17,11.14 17.89,10.36L18.36,9.88C19.54,8.71 19.54,6.81 18.36,5.64C17.19,4.46 15.29,4.46 14.12,5.64L10.79,8.97L9.38,7.55L12.71,4.22M13.41,9.17C13.8,8.78 14.44,8.78 14.83,9.17C16.2,10.54 16.61,12.5 16.06,14.23L14.28,12.46C14.23,11.78 13.94,11.11 13.41,10.59C13,10.2 13,9.56 13.41,9.17Z" /></svg>`;
    disconnectButton.addEventListener(
      "click",
      this.disconnectWallet.bind(this),
    );
    return disconnectButton;
  }

  private async copyWalletAddress() {
    if (this.walletAddress) {
      await navigator.clipboard.writeText(this.walletAddress);
      new Notice("Wallet address copied to clipboard");
    }
  }

  private async disconnectWallet() {
    await walletManager.disconnect();
    this.updateStatusBar();
    new Notice("Wallet disconnected");
  }

  private async addSyncButtonToLeaf(leaf: WorkspaceLeaf) {
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      await this.addSyncButton(view);
    }
  }

  private async addSyncButton(view: MarkdownView) {
    const headerEl = view.containerEl.querySelector(".view-header");
    if (!headerEl) return;

    this.removePreviousSyncButton(headerEl);
    const syncButton = this.createSyncButton();
    const file = view.file;

    if (file) {
      await this.updateSyncButtonState(syncButton, file);
      this.addSyncButtonClickListener(syncButton, file);
    }

    this.addSyncButtonToHeader(headerEl, syncButton);
  }

  private removePreviousSyncButton(headerEl: Element) {
    headerEl.querySelector(".arweave-sync-button")?.remove();
  }

  private createSyncButton() {
    const syncButton = document.createElement("button");
    syncButton.addClass("clickable-icon", "view-action", "arweave-sync-button");
    syncButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class ="svg-icon lucide-more-vertical sync-button" width="24"height="24" viewBox="0 0 24 24"><title>Sync current file to Arweave</title><path d="M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z" /></svg>`;
    return syncButton;
  }

  private async updateSyncButtonState(syncButton: HTMLElement, file: TFile) {
    const syncState = await this.getFileSyncState(file);
    console.log(`Sync state for ${file.path}: ${syncState}`);

    const stateConfig = {
      "new-file": {
        color: "var(--text-error)",
        title: "New file, click to sync",
      },
      "updated-file": {
        color: "var(--text-warning)",
        title: "File updated, click to sync",
      },
      synced: {
        color: "var(--text-success)",
        title: "File is up to date with Arweave",
        disabled: true,
      },
    };

    const config = stateConfig[syncState];
    this.setSyncButtonState(
      syncButton,
      syncState,
      config.color,
      config.title,
      config.disabled,
    );
  }

  private setSyncButtonState(
    button: HTMLElement,
    className: string,
    color: string,
    title: string,
    disabled: boolean = false,
  ) {
    button.removeClass("new-file", "updated-file", "synced");
    button.addClass(className);

    const svgPath = button.querySelector("path");
    if (svgPath) {
      svgPath.setAttribute("fill", color);
    }

    button.setAttribute("aria-label", title);
    button.setAttribute("title", title);

    if (disabled) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  private addSyncButtonClickListener(syncButton: HTMLElement, file: TFile) {
    syncButton.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!syncButton.hasAttribute("disabled")) {
        syncButton.addClass("uploading");
        await this.syncFile(file);
        await this.refreshRemoteConfig();
        syncButton.removeClass("uploading");
      }
    });
  }

  private addSyncButtonToHeader(headerEl: Element, syncButton: HTMLElement) {
    let rightIconsContainer =
      headerEl.querySelector(".view-actions") ||
      headerEl.createEl("div", { cls: "view-header-right-icons" });

    const viewActions = headerEl.querySelector(".view-actions");
    if (viewActions) {
      headerEl.insertBefore(viewActions, rightIconsContainer);
    }

    rightIconsContainer.appendChild(syncButton);
  }

  async handleWalletConnection(walletJson: string) {
    const wallet = JSON.parse(walletJson);
    await this.aoManager.initialize(wallet);
    this.walletAddress = await this.arweave.wallets.jwkToAddress(wallet);
    this.arweaveUploader.setWallet(wallet);

    this.updateStatusBar();

    try {
      await this.updateConfigsFromAO();
      this.checkForNewFiles();
    } catch (error) {
      console.error("Error during wallet connection:", error);
      new Notice(
        `Error: ${error.message}\nCheck the console for more details.`,
      );
    }
  }

  private async updateConfigsFromAO() {
    const aoUploadConfig = await this.aoManager.getUploadConfig();
    if (aoUploadConfig) {
      this.settings.remoteUploadConfig = aoUploadConfig;
      this.mergeUploadConfigs();
    }

    this.vaultImportManager = new VaultImportManager(
      this.app.vault,
      this.settings.encryptionPassword,
      this.settings.remoteUploadConfig,
    );
  }

  private checkForNewFiles() {
    const newFiles = this.getNewFilesFromRemote();
    if (newFiles.length > 0) {
      new Notice("Wallet connected. New files available for import.");
    } else {
      new Notice("Wallet connected. No new files to import.");
    }
  }

  private getNewFilesFromRemote(): string[] {
    return Object.keys(this.settings.remoteUploadConfig).filter(
      (filePath) => !this.settings.localUploadConfig[filePath],
    );
  }

  async handleWalletDisconnection() {
    this.walletAddress = null;
    this.arweaveUploader.setWallet(null);
    await this.aoManager.initialize(null);
    this.updateStatusBar();
    new Notice("Wallet disconnected successfully");
  }

  private mergeUploadConfigs() {
    for (const [filePath, fileInfo] of Object.entries(
      this.settings.remoteUploadConfig,
    )) {
      if (
        !this.settings.localUploadConfig[filePath] ||
        (fileInfo as FileUploadInfo).timestamp >
          this.settings.localUploadConfig[filePath].timestamp
      ) {
        this.settings.localUploadConfig[filePath] = fileInfo as FileUploadInfo;
      }
    }
    this.saveSettings();
  }

  async importFilesFromArweave(selectedFiles: string[]) {
    try {
      await this.vaultImportManager.importFilesFromArweave(selectedFiles);
      new Notice("File import completed!");
    } catch (error) {
      console.error("Error during file import:", error);
      new Notice(
        `Error: ${error.message}\nCheck the console for more details.`,
      );
    }
  }

  async fetchUploadConfigFromAO() {
    try {
      const aoUploadConfig = await this.aoManager.getUploadConfig();
      if (aoUploadConfig) {
        this.settings.remoteUploadConfig = aoUploadConfig;
        this.mergeUploadConfigs();
        await this.saveSettings();
        console.log("Upload config fetched from AO and saved");
      }
    } catch (error) {
      console.error("Failed to fetch upload config from AO:", error);
      new Notice("Failed to fetch upload config from AO");
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.localUploadConfig = this.settings.localUploadConfig || {};
    this.settings.remoteUploadConfig = this.settings.remoteUploadConfig || {};
  }

  async saveSettings() {
    await this.saveData(this.settings);
    console.log("Settings saved");
  }

  async syncFile(file: TFile) {
    const syncButton = this.getSyncButtonForFile(file);
    if (syncButton) {
      syncButton.addClass("uploading");
    }

    try {
      const { content, fileHash } = await this.prepareFileContent(file);
      const currentFileInfo = this.settings.localUploadConfig[file.path];
      const previousVersionTxId = currentFileInfo ? currentFileInfo.txId : null;
      const versionNumber = currentFileInfo
        ? currentFileInfo.versionNumber + 1
        : 1;

      const txId = await this.arweaveUploader.uploadFile(
        file.path,
        content,
        fileHash,
        previousVersionTxId,
        versionNumber,
      );

      const newFileInfo: FileUploadInfo = {
        txId,
        timestamp: Date.now(),
        fileHash,
        encrypted: true,
        filePath: file.path,
        previousVersionTxId,
        versionNumber,
      };

      this.settings.localUploadConfig[file.path] = newFileInfo;
      this.settings.remoteUploadConfig[file.path] = newFileInfo;

      await this.saveSettings();
      await this.aoManager.updateUploadConfig(this.settings.remoteUploadConfig);

      console.log(
        "Updated remoteUploadConfig:",
        this.settings.remoteUploadConfig,
      );

      this.updateUIAfterSync(file);
      new Notice(`File ${file.name} synced to Arweave (encrypted)`);
    } catch (error) {
      this.handleSyncError(file, error);
    } finally {
      if (syncButton) {
        syncButton.removeClass("uploading");
      }
    }
  }

  private getSyncButtonForFile(file: TFile): HTMLElement | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.containerEl.querySelector(
      ".arweave-sync-button",
    ) as HTMLElement | null;
  }

  private async prepareFileContent(file: TFile) {
    const content = await this.app.vault.read(file);
    const fileHash = await this.getFileHash(file);
    const encryptedContent = encrypt(content, this.settings.encryptionPassword);
    return { content: encryptedContent, fileHash };
  }

  async refreshRemoteConfig() {
    try {
      const remoteConfig = await this.aoManager.getUploadConfig();
      if (remoteConfig) {
        this.settings.remoteUploadConfig = remoteConfig;
        await this.saveSettings();
        console.log(
          "Remote config refreshed:",
          this.settings.remoteUploadConfig,
        );
      }
    } catch (error) {
      console.error("Failed to refresh remote config:", error);
    }
  }

  private updateUIAfterSync(file: TFile) {
    this.modifiedFiles.delete(file.path);
    new Notice(`File ${file.name} synced to Arweave (encrypted)`);

    const syncButton = this.getSyncButtonForFile(file);
    if (syncButton) {
      this.updateSyncButtonState(syncButton, file);
    }
  }

  private handleSyncError(file: TFile, error: Error) {
    new Notice(`Failed to sync file: ${error.message}`);
    this.modifiedFiles.add(file.path);
  }

  private async handleFileModify(file: TFile) {
    console.log("File updated:", file.path);

    const newHash = await this.getFileHash(file);
    const currentConfig = this.settings.localUploadConfig[file.path];

    if (!currentConfig || currentConfig.fileHash !== newHash) {
      this.settings.localUploadConfig[file.path] = {
        txId: currentConfig?.txId || "",
        timestamp: Date.now(),
        fileHash: newHash,
        encrypted: true,
        filePath: file.path,
        previousVersionTxId: currentConfig?.txId || null,
        versionNumber: currentConfig?.versionNumber || 0,
      };
      this.modifiedFiles.add(file.path);
      await this.saveSettings();
    }

    this.updateSyncButtonForActiveFile(file);
    this.updateSyncSidebarFile(file);
  }

  private updateSyncButtonForActiveFile(file: TFile) {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file === file) {
      const syncButton = activeView.containerEl.querySelector(
        ".arweave-sync-button",
      ) as HTMLElement;
      if (syncButton) {
        this.updateSyncButtonState(syncButton, file);
      } else {
        console.log("No sync button found");
      }
    }
  }

  async handleFileRename(file: TFile, oldPath: string) {
    if (
      this.settings.localUploadConfig[oldPath] ||
      this.settings.remoteUploadConfig[oldPath]
    ) {
      console.log(`File renamed from ${oldPath} to ${file.path}`);

      this.updateConfigsAfterRename(oldPath, file.path);
      this.modifiedFiles.add(file.path);
      this.modifiedFiles.delete(oldPath);

      await this.saveSettings();
      await this.aoManager.renameUploadConfig(oldPath, file.path);

      this.updateSyncButtonForActiveFile(file);
      this.updateSyncSidebarFile(file);
    }
  }

  private updateConfigsAfterRename(oldPath: string, newPath: string) {
    const updateConfig = (config: Record<string, FileUploadInfo>) => {
      if (config[oldPath]) {
        config[newPath] = { ...config[oldPath], filePath: newPath };
        delete config[oldPath];
      }
    };

    updateConfig(this.settings.localUploadConfig);
    updateConfig(this.settings.remoteUploadConfig);
  }

  async handleFileDelete(file: TFile) {
    if (
      this.settings.localUploadConfig[file.path] ||
      this.settings.remoteUploadConfig[file.path]
    ) {
      console.log("File deleted:", file.path);

      delete this.settings.localUploadConfig[file.path];
      delete this.settings.remoteUploadConfig[file.path];
      this.modifiedFiles.delete(file.path);

      await this.saveSettings();

      try {
        await this.aoManager.deleteUploadConfig(file.path);
        console.log("File deleted from remote config:", file.path);
      } catch (error) {
        console.error("Error deleting file from remote config:", error);
        new Notice(
          `Failed to delete ${file.path} from remote config. Please try again later.`,
        );
      }

      this.updateSyncButtonForActiveFile(file);
      this.updateSyncSidebarFile(file);
    }
  }

  async exportFilesToArweave(filesToExport: string[]) {
    const totalFiles = filesToExport.length;
    let exportedFiles = 0;

    for (const filePath of filesToExport) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        try {
          const content = await this.app.vault.read(file);
          const encryptedContent = encrypt(
            content,
            this.settings.encryptionPassword,
          );
          const fileHash = await this.getFileHash(file);

          const currentFileInfo = this.settings.localUploadConfig[filePath];
          const previousVersionTxId = currentFileInfo
            ? currentFileInfo.txId
            : null;
          const versionNumber = currentFileInfo
            ? currentFileInfo.versionNumber + 1
            : 1;

          const txId = await this.arweaveUploader.uploadFile(
            filePath,
            encryptedContent,
            fileHash,
            previousVersionTxId,
            versionNumber,
          );

          const fileInfo: FileUploadInfo = {
            txId,
            timestamp: Date.now(),
            fileHash,
            encrypted: true,
            filePath: file.path,
            previousVersionTxId,
            versionNumber,
          };
          this.settings.localUploadConfig[filePath] = fileInfo;
          this.settings.remoteUploadConfig[filePath] = fileInfo;

          exportedFiles++;
          new Notice(`Exported ${exportedFiles}/${totalFiles} files`);
        } catch (error) {
          console.error(`Error exporting file ${filePath}:`, error);
          new Notice(`Failed to export ${filePath}. Error: ${error.message}`);
        }
      }
    }

    await this.saveSettings();
    await this.aoManager.updateUploadConfig(this.settings.remoteUploadConfig);
    new Notice(`Exported ${exportedFiles}/${totalFiles} files to Arweave`);

    this.updateActiveSyncButton();
    this.refreshSyncSidebar();
  }

  private updateActiveSyncButton() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file) {
      const syncButton = activeView.containerEl.querySelector(
        ".arweave-sync-button",
      ) as HTMLElement;
      if (syncButton) {
        this.updateSyncButtonState(syncButton, activeView.file);
      }
    }
  }

  async getFileHash(file: TFile): Promise<string> {
    const content = await this.app.vault.read(file);
    const buffer = await this.arweave.utils.stringToBuffer(content);
    return await this.arweave.utils.bufferTob64Url(
      await this.arweave.crypto.hash(buffer),
    );
  }

  async decryptFileContent(encryptedContent: string): Promise<string> {
    if (!this.settings.encryptionPassword) {
      throw new Error("Encryption password not set");
    }
    return decrypt(encryptedContent, this.settings.encryptionPassword);
  }

  async fetchPreviousVersion(
    filePath: string,
    n: number,
    uploadConfig: UploadConfig,
  ): Promise<any> {
    const result = await this.arweaveUploader.fetchPreviousVersion(
      filePath,
      n,
      uploadConfig,
    );
    if (result) {
      return {
        ...result,
        timestamp: result.timestamp || Date.now() / 1000,
      };
    }
    return null;
  }

  async openPreviousVersion(file: TFile, n: number) {
    const loadingNotice = new Notice("Fetching previous version...", 0);
    try {
      const previousVersionInfo = await this.fetchPreviousVersion(
        file.path,
        n,
        this.settings.localUploadConfig,
      );
      loadingNotice.hide();

      if (!previousVersionInfo) {
        new Notice(`No previous version found (requested: ${n} versions back)`);
        return;
      }

      const decryptedContent = await this.decryptFileContent(
        previousVersionInfo.content,
      );
      const formattedDate = new Date(
        previousVersionInfo.timestamp * 1000,
      ).toLocaleString();
      const safeFilename = this.createSafeFilename(file.basename, n);

      const newFile = await this.app.vault.create(
        `${file.parent?.path || ""}/${safeFilename}`,
        `---
        Last synced: ${formattedDate}
        Original file: ${file.path}
        Version: ${n} versions ago
        ---

        ${decryptedContent}`,
      );

      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(newFile);

      new Notice(
        `Opened version from ${formattedDate} (${n} transactions ago)`,
      );
    } catch (error) {
      loadingNotice.hide();
      new Notice(`Error opening previous version: ${error.message}`);
      console.error("Error opening previous version:", error);
    }
  }

  private createSafeFilename(
    originalName: string,
    versionNumber: number,
  ): string {
    const nameWithoutExtension = originalName.replace(/\.[^/.]+$/, "");
    const safeName = nameWithoutExtension.replace(/[\\/:*?"<>|]/g, "_");
    return `${safeName} (${versionNumber} versions ago).md`;
  }

  async isFileNeedingSync(file: TFile): Promise<boolean> {
    const newHash = await this.getFileHash(file);
    const currentConfig = this.settings.localUploadConfig[file.path];
    return !currentConfig || currentConfig.fileHash !== newHash;
  }

  async getFileSyncState(
    file: TFile,
  ): Promise<"new-file" | "updated-file" | "synced"> {
    const currentFileHash = await this.getFileHash(file);
    const remoteConfig = this.settings.remoteUploadConfig[file.path];

    if (!remoteConfig) {
      console.log(`${file.path} is a new file`);
      return "new-file";
    } else if (remoteConfig.fileHash !== currentFileHash) {
      console.log(`${file.path} is an updated file`);
      return "updated-file";
    } else {
      console.log(`${file.path} is synced`);
      return "synced";
    }
  }

  async activateSyncSidebar() {
    const { workspace } = this.app;
    let leaf: any = workspace.getLeavesOfType(SYNC_SIDEBAR_VIEW)[0];

    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      await leaf.setViewState({ type: SYNC_SIDEBAR_VIEW, active: true });
    }

    workspace.revealLeaf(leaf);

    if (leaf.view instanceof SyncSidebar) {
      this.activeSyncSidebar = leaf.view;
    }
  }

  updateSyncSidebarFile(file: TFile) {
    this.updateView((view) => view.updateFileStatus(file));
  }

  refreshSyncSidebar() {
    this.updateView((view) => view.refresh());
  }

  private updateView(updater: (view: SyncSidebar) => void) {
    const leaf = this.app.workspace.getLeavesOfType(SYNC_SIDEBAR_VIEW)[0];
    if (leaf && leaf.view instanceof SyncSidebar) {
      updater(leaf.view);
    }
  }

  onunload() {
    console.log("Unloading ArweaveSync plugin");
    // Perform any cleanup tasks here
  }
}
