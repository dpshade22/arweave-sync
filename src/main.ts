import {
  Plugin,
  TFile,
  MarkdownView,
  Notice,
  WorkspaceLeaf,
  TFolder,
  Modal,
} from "obsidian";
import { AOManager } from "./managers/aoManager";
import {
  initializeWalletManager,
  walletManager,
} from "./managers/walletManager";
import { VaultSyncManager } from "./managers/vaultSyncManager";
import {
  UploadConfig,
  FileUploadInfo,
  FileVersion,
  ArweaveSyncSettings,
  DEFAULT_SETTINGS,
} from "./types";
import { WalletConnectModal } from "./components/WalletConnectModal";
import { ConfirmationModal } from "./components/ConfirmationModal";
import { FileHistoryModal } from "./components/FileHistoryModal";
import Arweave from "arweave";
import { ArweaveSyncSettingTab } from "./settings/settings";
import { debounce } from "./utils/helpers";
import { SyncSidebar, SYNC_SIDEBAR_VIEW } from "./components/SyncSidebar";
import { testEncryptionWithSpecificFile } from "./utils/testEncryption";
import { ArPublishManager } from "./managers/arPublishManager";

import "buffer";
import "process";
import "./styles.css";

export default class ArweaveSync extends Plugin {
  settings: ArweaveSyncSettings;
  public vaultSyncManager: VaultSyncManager;
  public aoManager: AOManager;
  private arPublishManager: ArPublishManager;
  private arweave: Arweave;
  private walletAddress: string | null = null;
  private statusBarItem: HTMLElement;
  private activeSyncSidebar: SyncSidebar | null = null;
  private isConnecting: boolean = false;
  private idleTimer: number | null = null;
  private autoSyncInterval: number | null = null;

  async onload() {
    await this.loadSettings();
    this.initializeManagers();
    this.setupEventListeners();
    this.setupUI();
    this.addCommands();
    this.registerView(SYNC_SIDEBAR_VIEW, (leaf) => new SyncSidebar(leaf, this));

    this.addRibbonIcon("wallet", "Arweave sync", () => {
      if (this.walletAddress) {
        this.activateSyncSidebar();
      } else {
        this.showWalletConnectModal();
      }
    });

    this.updateSyncUI();

    if (this.settings.syncOnStartup) {
      this.performInitialSync();
    }

    if (this.settings.fullAutoSync) {
      this.startAutoSync();
    }
  }

  private initializeManagers() {
    initializeWalletManager();
    this.arPublishManager = new ArPublishManager(this.app, this);

    this.aoManager = new AOManager(this);
    this.arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });

    this.vaultSyncManager = new VaultSyncManager(
      this,
      this.settings.remoteUploadConfig,
      this.settings.localUploadConfig,
    );

    const encryptionPassword = walletManager.getEncryptionPassword();
    if (encryptionPassword) {
      this.vaultSyncManager.setEncryptionPassword(encryptionPassword);
    }
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

    this.registerEvent(
      this.app.workspace.on("file-open", this.handleFileOpen.bind(this)),
    );

    if (this.settings.autoExportOnIdle) {
      this.startIdleTimer();
    }

    // this.registerEvent(
    //   this.app.workspace.on(
    //     "editor-change",
    //     this.handleEditorChange.bind(this),
    //   ),
    // );
  }

  private setupUI() {
    this.createStatusBarItem();
    this.setupSyncButton();
    this.addSettingTab(new ArweaveSyncSettingTab(this.app, this));
  }

  private setupSyncButton() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile) {
          menu.addItem((item) => {
            item
              .setTitle("View file history")
              .setIcon("history")
              .onClick(() => this.openFileHistory(file));
          });
          menu.addItem((item) => {
            item
              .setTitle("Force pull from Arweave")
              .setIcon("download-cloud")
              .onClick(() => this.forcePullCurrentFile(file));
          });
          menu.addItem((item) => {
            item
              .setTitle("Force push to Arweave")
              .setIcon("upload-cloud")
              .onClick(() => this.forcePushCurrentFile(file));
          });
          menu.addItem((item) => {
            item
              .setTitle("Sync with Arweave")
              .setIcon("sync")
              .onClick(() => this.syncFile(file));
          });
        }

        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle("Publish as website to Arweave")
              .setIcon("globe")
              .onClick(() => this.publishToArweave(file));
          });
        }
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
      id: "open-file-history",
      name: "Open File History",
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          if (!checking) {
            this.openFileHistory(activeFile);
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "open-arweave-sync-sidebar",
      name: "Open Arweave sync sidebar",
      callback: () => this.activateSyncSidebar(),
    });

    this.addCommand({
      id: "open-wallet-connect-modal",
      name: "Connect Arweave wallet",
      callback: () => this.showWalletConnectModal(),
    });

    this.addCommand({
      id: "force-refresh-sidebar-files",
      name: "Force refresh sidebar files",
      callback: () => {
        this.refreshSyncSidebar();
        new Notice("Sidebar files refreshed");
      },
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
      : this.statusBarItem.setText("Arweave wallet: Not Connected");
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
    if (leaf.view instanceof MarkdownView) {
      await this.addSyncButton(leaf.view);
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
    syncButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="svg-icon lucide-more-vertical sync-button" width="24" height="24" viewBox="0 0 24 24"><path d="M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z" /></svg>`;
    return syncButton;
  }

  async updateSyncButtonState(syncButton: HTMLElement, file: TFile) {
    const { syncState } = await this.vaultSyncManager.checkFileSync(file);

    const stateConfig: Record<
      string,
      { color: string; title: string; disabled?: boolean }
    > = {
      "new-local": {
        color: "var(--text-error)",
        title: "New local file, click to sync",
      },
      "new-remote": {
        color: "var(--text-error)",
        title: "New remote file, click to sync",
      },
      "local-newer": {
        color: "var(--text-warning)",
        title: "Local version is newer, click to sync",
      },
      "remote-newer": {
        color: "var(--text-warning)",
        title: "Remote version is newer, click to sync",
      },
      synced: {
        color: "var(--text-success)",
        title: "File is up to date with Arweave",
        disabled: true,
      },
    };

    const config = stateConfig[syncState] || {
      color: "var(--text-muted)",
      title: "Unknown sync state",
      disabled: true,
    };

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

    // Use setAttrs for Obsidian's native tooltip
    button.setAttrs({
      "aria-label": title,
      "aria-disabled": disabled ? "true" : "false",
    });

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
        await this.vaultSyncManager.updateRemoteConfig();
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

  public updateSyncUI() {
    // Update the status bar
    this.updateStatusBar();

    // Update the active sync button
    this.updateActiveSyncButton();

    // Refresh the sync sidebar
    this.refreshSyncSidebar();
  }

  async handleWalletConnection(walletJson: string) {
    if (this.isConnecting) {
      return;
    }
    this.isConnecting = true;

    await walletManager.connect(new File([walletJson], "wallet.json"));
    this.walletAddress = walletManager.getAddress();

    try {
      await walletManager.connect(new File([walletJson], "wallet.json"));
      const encryptionPassword = walletManager.getEncryptionPassword();
      if (encryptionPassword) {
        this.vaultSyncManager.setEncryptionPassword(encryptionPassword);
      } else {
        throw new Error("Failed to derive encryption password from wallet");
      }

      this.walletAddress = walletManager.getAddress();
      await this.aoManager.initialize(walletManager.getJWK());

      this.updateStatusBar();

      // this.aoManager.updateUploadConfig(this.settings.remoteUploadConfig);
      this.vaultSyncManager.updateRemoteConfig();
      const newOrModifiedFiles = await this.checkForNewFiles();

      if (
        this.settings.autoImportUnsyncedChanges &&
        newOrModifiedFiles.length > 0
      ) {
        await this.importFilesFromArweave(newOrModifiedFiles);
        new Notice(
          `Automatically imported ${newOrModifiedFiles.length} new or modified files.`,
        );
      } else if (newOrModifiedFiles.length > 0) {
        new Notice(
          `${newOrModifiedFiles.length} new or modified files available for import.`,
        );
        this.refreshSyncSidebar();
        await this.openSyncSidebarWithImportTab();
      } else {
        new Notice("Wallet connected. No new files to import.");
      }
    } catch (error) {
      console.error("Error during wallet connection:", error);
      new Notice(
        `Error: ${error.message}\nCheck the console for more details.`,
      );
    } finally {
      this.isConnecting = false;
    }
  }

  async handleWalletDisconnection() {
    this.walletAddress = null;
    // Remove the setWallet call as it doesn't exist in VaultSyncManager
    await this.aoManager.initialize(null);
    this.updateStatusBar();
    new Notice("Wallet disconnected successfully");
  }

  private async checkForNewFiles() {
    const newOrModifiedFiles: string[] = [];

    // Iterate through remote upload config
    for (const [filePath, remoteFileInfo] of Object.entries(
      this.settings.remoteUploadConfig,
    )) {
      const localFile = this.app.vault.getAbstractFileByPath(filePath);

      if (!localFile) {
        // File doesn't exist locally
        newOrModifiedFiles.push(filePath);
      } else if (localFile instanceof TFile) {
        const localFileHash =
          await this.vaultSyncManager.getFileHash(localFile);
        const localFileTimestamp = localFile.stat.mtime;

        if (
          remoteFileInfo.fileHash !== localFileHash &&
          remoteFileInfo.timestamp > localFileTimestamp
        ) {
          // Remote file has different hash and is newer
          newOrModifiedFiles.push(filePath);
        }
      }
    }

    if (newOrModifiedFiles.length > 0) {
      new Notice(
        `Wallet connected. ${newOrModifiedFiles.length} new or modified files available for import.`,
      );
      this.refreshSyncSidebar();
      if (!this.settings.autoImportUnsyncedChanges)
        await this.openSyncSidebarWithImportTab();
    }

    return newOrModifiedFiles;
  }

  async initializeLocalUploadConfig(
    plugin: ArweaveSync,
  ): Promise<UploadConfig> {
    const localUploadConfig: UploadConfig = {};
    const files = plugin.app.vault.getFiles();

    for (const file of files) {
      const filePath = file.path;
      const fileHash = await plugin.vaultSyncManager.getFileHash(file);
      const existingConfig = plugin.settings.localUploadConfig[filePath];

      localUploadConfig[filePath] = {
        txId: existingConfig?.txId || "",
        timestamp: file.stat.mtime,
        fileHash: fileHash,
        encrypted: true,
        filePath: filePath,
        oldFilePath: existingConfig?.oldFilePath || null,
        previousVersionTxId: existingConfig?.previousVersionTxId || null,
        versionNumber: existingConfig?.versionNumber || 1,
      };
    }

    return localUploadConfig;
  }

  updateLocalConfig(filePath: string, fileInfo: FileUploadInfo) {
    this.settings.localUploadConfig[filePath] = fileInfo;
    this.saveSettings();
  }

  async importFilesFromArweave(selectedFiles: string[]) {
    try {
      await this.vaultSyncManager.importFilesFromArweave(selectedFiles);
    } catch (error) {
      console.error("Error during file import:", error);
      new Notice(
        `Error: ${error.message}\nCheck the console for more details.`,
      );
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.localUploadConfig = this.settings.localUploadConfig || {};
  }

  async saveSettings() {
    await this.saveData(this.settings);
    console.log("Settings saved");
  }

  async syncFile(file: TFile) {
    const syncButton = this.getSyncButtonForFile();
    if (syncButton) {
      syncButton.addClass("uploading");
    }

    try {
      // Only sync the specific file
      await this.vaultSyncManager.syncFile(file);
    } catch (error) {
      this.handleSyncError(file, error);
    } finally {
      if (syncButton) {
        syncButton.removeClass("uploading");
      }
    }

    this.updateSyncUI();
  }

  private getSyncButtonForFile(): HTMLElement | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.containerEl.querySelector(
      ".arweave-sync-button",
    ) as HTMLElement | null;
  }

  private handleSyncError(file: TFile, error: Error) {
    new Notice(`Failed to sync file: ${error.message}`);
  }

  private handleFileOpen(file: TFile | null) {
    if (file && this.settings.autoExportOnClose) {
      this.registerEvent(
        this.app.workspace.on(
          "file-open",
          this.handleFileClose.bind(this, file),
        ),
      );
    }
  }

  private async handleFileClose(oldFile: TFile, newFile: TFile | null) {
    if (oldFile !== newFile && this.settings.autoExportOnClose) {
      console.log(`File closed: ${oldFile.path}, triggering auto-export`);
      await this.autoExportFile(oldFile);
    }
  }

  private async handleFileModify(file: TFile) {
    if (file instanceof TFile) {
      this.restartIdleTimer();
    }

    const { syncState, fileHash } =
      await this.vaultSyncManager.checkFileSync(file);

    if (syncState !== "synced") {
      const currentConfig = this.settings.localUploadConfig[file.path];
      this.settings.localUploadConfig[file.path] = {
        encrypted: true,
        timestamp: Date.now(),
        txId: currentConfig?.txId || "",
        filePath: file.path,
        fileHash: fileHash,
        oldFilePath: currentConfig?.oldFilePath || null,
        previousVersionTxId: currentConfig?.txId || null,
        versionNumber: (currentConfig?.versionNumber || 0) + 1,
      };
      await this.saveSettings();
    }

    this.updateSyncUI();
  }

  async handleFileRename(file: TFile, oldPath: string) {
    // Update local config
    if (this.settings.localUploadConfig[oldPath]) {
      this.settings.localUploadConfig[file.path] = {
        ...this.settings.localUploadConfig[oldPath],
        filePath: file.path,
      };
      delete this.settings.localUploadConfig[oldPath];
    }

    console.log(`File renamed from ${oldPath} to ${file.path}`);
    await this.saveSettings();

    // Check if the file exists in the remote config
    const remoteConfig = await this.aoManager.getUploadConfig();
    if (remoteConfig && remoteConfig[oldPath]) {
      // File exists in remote config, so we need to update it
      remoteConfig[file.path] = {
        ...remoteConfig[oldPath],
        filePath: file.path,
        oldFilePath: oldPath,
      };
      delete remoteConfig[oldPath];

      try {
        await this.aoManager.updateUploadConfig(remoteConfig);
      } catch (error) {
        console.error("Error updating remote config after file rename:", error);
        new Notice(
          `Failed to update remote config after rename ${file.path}. Please try again later.`,
        );
      }
    }

    this.updateSyncUI();
  }

  async handleFileDelete(file: TFile) {
    // Update local config
    delete this.settings.localUploadConfig[file.path];
    console.log("File deleted:", file.path);

    await this.saveSettings();

    // Check if the file exists in the remote config
    const remoteConfig = await this.aoManager.getUploadConfig();
    if (remoteConfig && remoteConfig[file.path]) {
      // File exists in remote config, so we need to update it
      delete remoteConfig[file.path];

      try {
        await this.aoManager.updateUploadConfig(remoteConfig);
      } catch (error) {
        console.error(
          "Error updating remote config after file deletion:",
          error,
        );
        new Notice(
          `Failed to update remote config after deleting ${file.path}. Please try again later.`,
        );
      }
    }

    this.removeSyncSidebarFile(file.path);
    this.updateSyncUI();
  }

  // private async handleEditorChange(
  //   editor: Editor,
  //   info: MarkdownView | MarkdownFileInfo,
  // ) {
  //   if (info instanceof MarkdownView) {
  //     const file = info.file;
  //     if (file) {
  //       const { syncState } = await this.vaultSyncManager.checkFileSync(file);
  //       if (syncState === "remote-newer") {
  //         const modal = new RemoteNewerVersionModal(this.app, file, this);
  //         modal.open();
  //         const choice = await modal.awaitChoice();

  //         if (choice === "import") {
  //           await this.vaultSyncManager.importFileFromArweave(file.path);
  //           new Notice(`Imported newer version of ${file.name} from Arweave`);
  //           // Refresh the editor content
  //           const newContent = await this.app.vault.read(file);
  //           editor.setValue(newContent);
  //         } else {
  //           new Notice(
  //             `Proceeding with local edit of ${file.name}. Remote changes will be overwritten on next sync.`,
  //           );
  //         }
  //       }
  //     }
  //   }
  // }

  private removeSyncSidebarFile(filePath: string) {
    this.updateView((view) => {
      view.removeFile(filePath);
    });
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
    const buffer = Arweave.utils.stringToBuffer(content);
    return Arweave.utils.bufferTob64Url(await Arweave.crypto.hash(buffer));
  }

  async isFileNeedingSync(file: TFile): Promise<boolean> {
    const { syncState } = await this.vaultSyncManager.checkFileSync(file);
    return syncState !== "synced";
  }

  public async forcePushCurrentFile(file: TFile) {
    try {
      const confirmed = await this.confirmForcePush(file.name);
      if (!confirmed) {
        new Notice("Force push cancelled.");
        return;
      }

      await this.vaultSyncManager.forcePushFile(file);
      new Notice(`Successfully pushed ${file.name} to Arweave`);
      this.updateSyncUI();
    } catch (error) {
      console.error("Error force pushing file:", error);
      new Notice(`Failed to push ${file.name} to Arweave: ${error.message}`);
    }
  }

  private async confirmForcePush(fileName: string): Promise<boolean> {
    const modal = new ConfirmationModal(
      this.app,
      "Confirm Force Push",
      `<p>Are you sure you want to force push <strong>${fileName}</strong> to Arweave? This will overwrite the remote version.</p>`,
      "Force Push",
      "Cancel",
      false,
    );
    return await modal.awaitUserConfirmation();
  }

  public async forcePullCurrentFile(file: TFile) {
    try {
      const confirmed = await this.confirmForcePull(file.name);
      if (!confirmed) {
        new Notice("Force pull cancelled.");
        return;
      }

      await this.vaultSyncManager.forcePullFile(file);
      new Notice(
        `Successfully pulled the latest version of ${file.name} from Arweave`,
      );
      this.updateSyncUI();
    } catch (error) {
      console.error("Error force pulling file:", error);
      new Notice(`Failed to pull ${file.name} from Arweave: ${error.message}`);
    }
  }

  private async confirmForcePull(fileName: string): Promise<boolean> {
    const modal = new ConfirmationModal(
      this.app,
      "Confirm Force Pull",
      `<p>Are you sure you want to force pull <strong>${fileName}</strong> from Arweave? This will overwrite your local copy.</p>`,
      "Force Pull",
      "Cancel",
      false,
    );
    return await modal.awaitUserConfirmation();
  }

  async openFileHistory(file: TFile) {
    new FileHistoryModal(this.app, this, file).open();
  }

  async confirmRestore(fileName: string): Promise<boolean> {
    const modal = new ConfirmationModal(
      this.app,
      "Confirm Restore",
      `Are you sure you want to restore this version of ${fileName}? This will overwrite the current version.`,
      "Restore",
      "Cancel",
    );
    return await modal.awaitUserConfirmation();
  }

  public async activateSyncSidebar() {
    const { workspace } = this.app;
    let leaf: any = workspace.getLeavesOfType(SYNC_SIDEBAR_VIEW)[0];

    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      await leaf.setViewState({ type: SYNC_SIDEBAR_VIEW, active: true });
    }

    await workspace.revealLeaf(leaf);

    if (leaf.view instanceof SyncSidebar) {
      this.activeSyncSidebar = leaf.view;
    }
  }

  private async openSyncSidebarWithImportTab() {
    await this.activateSyncSidebar();
    if (this.activeSyncSidebar) {
      this.activeSyncSidebar.switchTab("import");
    }
  }

  updateSyncSidebarFile(file: TFile, oldPath?: string) {
    this.updateView((view) => {
      if (oldPath) {
        view.handleFileRename(file, oldPath);
      } else {
        view.updateFileStatus(file);
      }

      if (view.isVisible()) {
        view.refresh();
      }
    });
  }

  public async refreshSyncSidebar() {
    const leaves = this.app.workspace.getLeavesOfType(SYNC_SIDEBAR_VIEW);
    for (const leaf of leaves) {
      // Ensure the view is loaded
      if (leaf.view instanceof SyncSidebar) {
        const view = leaf.view;

        // Check if this view is currently active
        const isActiveView =
          this.app.workspace.getActiveViewOfType(SyncSidebar) === view;

        if (!isActiveView) {
          // Refresh in the background if not the active view
          setTimeout(() => view.refresh(), 0);
        } else {
          view.refresh();
        }
      }
    }
  }

  private updateView(updater: (view: SyncSidebar) => void) {
    const leaf = this.app.workspace.getLeavesOfType(SYNC_SIDEBAR_VIEW)[0];
    if (leaf && leaf.view instanceof SyncSidebar) {
      updater(leaf.view);
    }
  }

  async reinitializeAOManager() {
    if (this.aoManager) {
      await this.aoManager.initialize(walletManager.getJWK());
    }
  }

  private async publishToArweave(folder: TFolder) {
    try {
      await this.arPublishManager.publishWebsiteToArweave(folder);
      new Notice(`Folder "${folder.name}" published to Arweave as a website.`);
    } catch (error) {
      console.error(
        `Error publishing folder ${folder.name} to Arweave:`,
        error,
      );
      new Notice(
        `Failed to publish ${folder.name} to Arweave. Error: ${error.message}`,
      );
    }
  }

  private async performInitialSync() {
    const filesToSync = await Promise.all(
      this.app.vault.getFiles().map(async (file) => {
        const needsSync = await this.vaultSyncManager.isFileNeedingSync(file);
        return needsSync ? file : null;
      }),
    );

    const filesToSyncFiltered = filesToSync.filter(
      (file): file is TFile => file !== null,
    );

    if (filesToSyncFiltered.length > 0) {
      await this.vaultSyncManager.syncFiles(filesToSyncFiltered);
    }
  }

  private async performFinalSync() {
    const filesToSync = await Promise.all(
      this.app.vault.getFiles().map(async (file) => {
        const needsSync = await this.vaultSyncManager.isFileNeedingSync(file);
        return needsSync ? file : null;
      }),
    );

    const filesToSyncFiltered = filesToSync.filter(
      (file): file is TFile => file !== null,
    );

    if (filesToSyncFiltered.length > 0) {
      await this.vaultSyncManager.syncFiles(filesToSyncFiltered);
    }
  }

  private handleVisibilityChange() {
    if (typeof document.hidden !== "undefined") {
      if (document.hidden) {
        // Page is hidden (computer might be going to sleep or app is in background)
        this.performFinalSync();
      } else {
        // Page is visible again (computer woke up or app is in foreground)
        this.performInitialSync();
      }
    }
  }

  public startIdleTimer() {
    console.log("Starting idle timer");
    this.stopIdleTimer();
    this.idleTimer = window.setTimeout(
      this.handleIdle.bind(this),
      this.settings.idleTimeForAutoExport * 60 * 1000,
    );
  }

  public stopIdleTimer() {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  public restartIdleTimer() {
    if (this.settings.autoExportOnIdle) {
      this.startIdleTimer();
    }
  }

  private async handleIdle() {
    new Notice("Idle timer triggered, starting auto-export");
    const modifiedFiles = await Promise.all(
      this.app.vault.getMarkdownFiles().map(async (file) => {
        const needsSync = await this.vaultSyncManager.isFileNeedingSync(file);
        return needsSync ? file : null;
      }),
    );

    const filesToSync = modifiedFiles.filter(
      (file): file is TFile => file !== null,
    );

    if (filesToSync.length > 0) {
      new Notice(`Found ${filesToSync.length} files needing sync`);
      await this.vaultSyncManager.syncFiles(filesToSync);
    } else {
      new Notice("No files need syncing");
    }
  }

  private async autoExportFile(file: TFile) {
    try {
      const localConfig = this.settings.localUploadConfig[file.path];
      const remoteConfig = this.settings.remoteUploadConfig[file.path];

      if (
        !localConfig ||
        !remoteConfig ||
        localConfig.fileHash !== remoteConfig.fileHash
      ) {
        await this.vaultSyncManager.syncFile(file);
      } else {
        console.log(
          `Skipping auto-export for file: ${file.path} (no changes detected)`,
        );
      }
    } catch (error) {
      console.error(`Failed to auto-export file ${file.path}:`, error);
    }
  }

  private startAutoSync() {
    this.stopAutoSync(); // Clear any existing interval
    const interval = this.settings.syncInterval * 60 * 1000; // Convert minutes to milliseconds
    this.autoSyncInterval = window.setInterval(
      () => this.performFullSync(),
      interval,
    );
  }

  private stopAutoSync() {
    if (this.autoSyncInterval) {
      window.clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
    }
  }

  private async performFullSync() {
    console.log("Performing full sync...");
    const filesToSync = this.vaultSyncManager.getFilesToSync();
    await this.vaultSyncManager.syncFiles(filesToSync);
    this.updateSyncUI();
  }

  async incrementFilesSynced() {
    this.settings.monthlyFilesSynced++;
    this.settings.lifetimeFilesSynced++;
    await this.saveSettings();
  }

  async checkMonthlyReset() {
    const now = new Date();
    const lastReset = new Date(this.settings.monthlyResetDate);

    if (
      now.getMonth() !== lastReset.getMonth() ||
      now.getFullYear() !== lastReset.getFullYear()
    ) {
      this.settings.monthlyFilesSynced = 0;
      this.settings.currentMonthSpend = 0;
      this.settings.monthlyResetDate = now.getTime();
      await this.saveSettings();
    }
  }

  public async checkSpendingLimit(cost: number): Promise<boolean> {
    await this.checkMonthlyReset();

    if (
      this.settings.currentMonthSpend + cost >
      this.settings.monthlyArweaveSpendLimit
    ) {
      new Notice(`Monthly spending limit reached. Skipping sync.`);
      return false;
    }

    this.settings.currentMonthSpend += cost;
    await this.saveSettings();
    return true;
  }

  async onunload() {
    console.log("Unloading ArweaveSync plugin");
    if (this.settings.autoExportOnClose) {
      await this.performFinalSync();
    }
    this.stopAutoSync(); // Stop auto-sync when unloading the plugin
    this.stopIdleTimer();
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange.bind(this),
    );
  }
}
