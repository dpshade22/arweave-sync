import {
  Plugin,
  TFile,
  addIcon,
  MarkdownView,
  Notice,
  App,
  Setting,
  WorkspaceLeaf,
} from "obsidian";
import { ArweaveUploader } from "./managers/arweaveUploader";
import { AOManager } from "./managers/aoManager";
import {
  initializeWalletManager,
  walletManager,
} from "./managers/walletManager";
import { VaultRecreationManager } from "./managers/vaultRecreationManager";
import {
  UploadConfig,
  FileUploadInfo,
  ArweaveSyncSettings,
  DEFAULT_SETTINGS,
} from "./types";
import { WalletConnectModal } from "./components/WalletConnectModal";
import Arweave from "arweave";
import { ArweaveSyncSettingTab } from "./settings/settings";
import { JWKInterface } from "arweave/node/lib/wallet";
import { encrypt, decrypt } from "./utils/encryption";
import { debounce } from "./utils/helpers";
import "./styles.css";
export default class ArweaveSync extends Plugin {
  settings: ArweaveSyncSettings;
  private arweaveUploader: ArweaveUploader;
  private aoManager: AOManager;
  private vaultRecreationManager: VaultRecreationManager;
  private arweave: Arweave;
  private walletAddress: string | null = null;
  private statusBarItem: HTMLElement;
  private modifiedFiles: Set<string> = new Set();

  constructor(app: App, manifest: any) {
    super(app, manifest);
    this.arweaveUploader = new ArweaveUploader();
    this.aoManager = new AOManager();
    this.arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });
  }

  async onload() {
    await this.loadSettings();

    this.vaultRecreationManager = new VaultRecreationManager(
      this.app.vault,
      this.settings.encryptionPassword,
      this.settings.remoteUploadConfig,
    );

    // Initialize wallet manager
    initializeWalletManager();

    if (walletManager.isWalletLoaded()) {
      const cachedWalletJson = walletManager.getWalletJson();
      if (cachedWalletJson) {
        await this.handleWalletConnection(cachedWalletJson);
      }
    }

    walletManager.on("wallet-connected", async (walletJson: string) => {
      await this.handleWalletConnection(walletJson);
    });

    walletManager.on("wallet-disconnected", () => {
      this.handleWalletDisconnection();
    });

    // Add wallet connect button to left ribbon
    this.addRibbonIcon(
      "wallet",
      "Connect Arweave Wallet",
      (evt: MouseEvent) => {
        this.showWalletConnectModal();
      },
    );

    // Register the sync button in file menu
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

    // Watch for file changes
    this.registerEvent(
      this.app.vault.on("modify", (file: TFile) => this.updateFileInfo(file)),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TFile, oldPath: string) =>
        this.handleFileRename(file, oldPath),
      ),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TFile) => this.handleFileDelete(file)),
    );

    // Add status bar item
    this.createStatusBarItem();

    const debouncedAddSyncButtonToLeaf = debounce((leaf: WorkspaceLeaf) => {
      if (leaf) {
        this.addSyncButtonToLeaf(leaf);
      }
    }, 100); // 100ms debounce time

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", debouncedAddSyncButtonToLeaf),
    );

    this.addCommand({
      id: "recreate-vault",
      name: "Recreate Vault from Arweave",
      callback: () => this.vaultRecreationManager.recreateVault(),
    });

    this.addSettingTab(new ArweaveSyncSettingTab(this.app, this));
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
    if (this.walletAddress) {
      const slicedAddress = `${this.walletAddress.slice(0, 6)}...${this.walletAddress.slice(-4)}`;
      this.statusBarItem.setText(`Arweave Wallet: ${slicedAddress}`);
    } else {
      this.statusBarItem.setText("Arweave Wallet: Not Connected");
    }
  }

  private async addSyncButton(view: MarkdownView) {
    const headerEl = view.containerEl.querySelector(".view-header");
    if (!headerEl) return;

    // Remove existing sync button if any
    let existingButton = headerEl.querySelector(".arweave-sync-button");
    if (existingButton) {
      existingButton.remove();
    }

    const syncButton = headerEl.createEl("button", {
      cls: "arweave-sync-button",
    });

    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>sync</title><path d="M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z" /></svg>`;

    syncButton.innerHTML = svgIcon;

    const file = view.file;
    if (file) {
      const currentContent = await this.app.vault.read(file);
      const currentFileHash = await this.getFileHash(file);
      const remoteConfig = this.settings.remoteUploadConfig[file.path];

      if (!remoteConfig) {
        syncButton.classList.add("new-file");
        const svgPath = syncButton.querySelector("svg path");
        if (svgPath) {
          svgPath.setAttribute("fill", "red");
        }
        syncButton.setAttribute("title", "New file, click to sync");
      } else if (remoteConfig.fileHash !== currentFileHash) {
        syncButton.classList.add("updated-file");
        const svgPath = syncButton.querySelector("svg path");
        if (svgPath) {
          svgPath.setAttribute("fill", "orange");
        }
        syncButton.setAttribute("title", "File updated, click to sync");
      } else {
        syncButton.classList.add("synced");
        const svgPath = syncButton.querySelector("svg path");
        if (svgPath) {
          svgPath.setAttribute("fill", "green");
        }
        syncButton.setAttribute("disabled", "true");
        syncButton.setAttribute("title", "File is up to date with Arweave");
      }

      syncButton.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!syncButton.hasAttribute("disabled")) {
          syncButton.addClass("uploading");
          await this.syncFile(file);
          syncButton.removeClass("uploading");
        }
      });
    }

    // Find or create a container for the right-aligned icons
    let rightIconsContainer = headerEl.querySelector(".view-actions");
    if (!rightIconsContainer) {
      rightIconsContainer = headerEl.createEl("div", {
        cls: "view-header-right-icons",
      });
      headerEl.appendChild(rightIconsContainer);
    }

    // Move existing Obsidian icons to the left
    const viewActions = headerEl.querySelector(".view-actions");
    if (viewActions) {
      headerEl.insertBefore(viewActions, rightIconsContainer);
    }

    // Insert the sync button as the last child of the right icons container
    rightIconsContainer.appendChild(syncButton);
  }

  private addSyncButtonToLeaf(leaf: WorkspaceLeaf) {
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      this.addSyncButton(view);
    }
  }

  async handleWalletConnection(walletJson: string) {
    const wallet = JSON.parse(walletJson);
    await this.aoManager.initialize(wallet);
    this.walletAddress = await this.arweave.wallets.jwkToAddress(wallet);
    this.arweaveUploader.setWallet(wallet);

    this.updateStatusBar();

    try {
      // Fetch upload config from AO
      const aoUploadConfig = await this.aoManager.getUploadConfig();

      if (aoUploadConfig) {
        // Update remote config
        this.settings.remoteUploadConfig = aoUploadConfig;
        // Merge remote config with local config
        this.mergeUploadConfigs();
      }

      this.vaultRecreationManager = new VaultRecreationManager(
        this.app.vault,
        this.settings.encryptionPassword,
        this.settings.remoteUploadConfig,
      );

      new Notice("Wallet connected. Recreating vault...");
      await this.vaultRecreationManager.recreateVault();
      new Notice("Vault recreation completed!");
    } catch (error) {
      console.error(
        "Error during wallet connection or vault recreation:",
        error,
      );
      new Notice(
        `Error: ${error.message}\nCheck the console for more details.`,
      );

      if (
        error instanceof Error &&
        error.message.includes("Failed to recreate")
      ) {
        new Notice(
          "Some files could not be recreated. Please check your encryption password and try again.",
        );
      }
    }
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
      if (!this.settings.localUploadConfig[filePath]) {
        this.settings.localUploadConfig[filePath] = fileInfo as FileUploadInfo;
      } else {
        // If the file exists in both configs, use the one with the latest timestamp
        if (
          (fileInfo as FileUploadInfo).timestamp >
          this.settings.localUploadConfig[filePath].timestamp
        ) {
          this.settings.localUploadConfig[filePath] =
            fileInfo as FileUploadInfo;
        }
      }
    }
    this.saveSettings();
  }

  async fetchUploadConfigFromAO() {
    try {
      const aoUploadConfig = await this.aoManager.getUploadConfig();
      console.log("aoUploadConfig");
      console.log(aoUploadConfig);
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
    if (!this.settings.localUploadConfig) {
      this.settings.localUploadConfig = {};
    }
    if (!this.settings.remoteUploadConfig) {
      this.settings.remoteUploadConfig = {};
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    console.log("Settings saved");
  }

  async syncFile(file: TFile) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const syncButton = view?.containerEl.querySelector(
      ".arweave-sync-button",
    ) as HTMLElement;

    if (syncButton) {
      syncButton.addClass("uploading");
    }

    try {
      const content = await this.app.vault.read(file);
      const fileHash = await this.getFileHash(file);
      const encryptedContent = encrypt(
        content,
        this.settings.encryptionPassword,
      );

      const txId = await this.arweaveUploader.uploadFile(
        file.path,
        encryptedContent,
        fileHash,
      );

      const fileUploadInfo: FileUploadInfo = {
        txId,
        timestamp: Date.now(),
        fileHash,
        encrypted: true,
        filePath: file.path,
      };

      // Update both local and remote configs
      this.settings.localUploadConfig[file.path] = fileUploadInfo;
      this.settings.remoteUploadConfig[file.path] = fileUploadInfo;

      await this.saveSettings();
      await this.aoManager.updateUploadConfig(this.settings.localUploadConfig);

      this.modifiedFiles.delete(file.path);

      new Notice(`File ${file.name} synced to Arweave (encrypted)`);

      // Update the sync button state
      if (syncButton) {
        this.updateSyncButtonState(syncButton, file);
      }
    } catch (error) {
      new Notice(`Failed to sync file: ${error.message}`);
      this.modifiedFiles.add(file.path);
    } finally {
      if (syncButton) {
        syncButton.removeClass("uploading");
      }
    }
  }

  async updateFileInfo(file: TFile) {
    console.log("File updated:", file.path);

    const newHash = await this.getFileHash(file);

    if (
      !this.settings.localUploadConfig[file.path] ||
      this.settings.localUploadConfig[file.path].fileHash !== newHash
    ) {
      this.settings.localUploadConfig[file.path] = {
        txId: this.settings.localUploadConfig[file.path]?.txId || "",
        timestamp: Date.now(),
        fileHash: newHash,
        encrypted: true,
        filePath: file.path,
      };
      this.modifiedFiles.add(file.path);
      await this.saveSettings();
    }

    // Refresh the existing sync button for the current file
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file === file) {
      const syncButton = activeView.containerEl.querySelector(
        ".arweave-sync-button",
      ) as HTMLElement;
      if (syncButton) {
        this.updateSyncButtonState(syncButton, file);
      }
    }
  }

  private updateSyncButtonState(syncButton: HTMLElement, file: TFile) {
    syncButton.removeClass("new-file", "updated-file", "synced");
    syncButton.removeAttribute("disabled");

    if (this.modifiedFiles.has(file.path)) {
      syncButton.addClass("updated-file");
      const svgPath = syncButton.querySelector("svg path");
      if (svgPath) {
        svgPath.setAttribute("fill", "orange");
      }
      syncButton.setAttribute("title", "File updated, click to sync");
    } else {
      syncButton.addClass("synced");
      const svgPath = syncButton.querySelector("svg path");
      if (svgPath) {
        svgPath.setAttribute("fill", "green");
      }
      syncButton.setAttribute("disabled", "true");
      syncButton.setAttribute("title", "File is up to date with Arweave");
    }
  }

  async handleFileRename(file: TFile, oldPath: string) {
    if (
      this.settings.localUploadConfig[oldPath] ||
      this.settings.remoteUploadConfig[oldPath]
    ) {
      console.log(`File renamed from ${oldPath} to ${file.path}`);

      // Update local configs
      if (this.settings.localUploadConfig[oldPath]) {
        this.settings.localUploadConfig[file.path] = {
          ...this.settings.localUploadConfig[oldPath],
          filePath: file.path,
        };
        delete this.settings.localUploadConfig[oldPath];
      }

      if (this.settings.remoteUploadConfig[oldPath]) {
        this.settings.remoteUploadConfig[file.path] = {
          ...this.settings.remoteUploadConfig[oldPath],
          filePath: file.path,
        };
        delete this.settings.remoteUploadConfig[oldPath];
      }

      // Mark the file as modified
      this.modifiedFiles.add(file.path);
      this.modifiedFiles.delete(oldPath);

      await this.saveSettings();

      // Update AO upload config
      await this.aoManager.renameUploadConfig(oldPath, file.path);

      // Update the sync button for the renamed file
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView && activeView.file === file) {
        const syncButton = activeView.containerEl.querySelector(
          ".arweave-sync-button",
        ) as HTMLElement;
        if (syncButton) {
          this.updateSyncButtonState(syncButton, file);
        }
      }
    }
  }

  async handleFileDelete(file: TFile) {
    if (
      this.settings.localUploadConfig[file.path] ||
      this.settings.remoteUploadConfig[file.path]
    ) {
      console.log("File deleted:", file.path);

      // Remove from local configs
      delete this.settings.localUploadConfig[file.path];
      delete this.settings.remoteUploadConfig[file.path];

      // Remove from modified files set
      this.modifiedFiles.delete(file.path);

      // Save local settings
      await this.saveSettings();

      // Delete from AO upload config
      try {
        await this.aoManager.deleteUploadConfig(file.path);
        console.log("File deleted from remote config:", file.path);
      } catch (error) {
        console.error("Error deleting file from remote config:", error);
        new Notice(
          `Failed to delete ${file.path} from remote config. Please try again later.`,
        );
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

  // Add a method to decrypt file content
  async decryptFileContent(encryptedContent: string): Promise<string> {
    if (!this.settings.encryptionPassword) {
      throw new Error("Encryption password not set");
    }
    return decrypt(encryptedContent, this.settings.encryptionPassword);
  }

  addStatusBarItem(): HTMLElement {
    return super.addStatusBarItem();
  }

  getModifiedFiles(): string[] {
    return Array.from(this.modifiedFiles);
  }

  getUnsyncedFiles(): string[] {
    return Array.from(this.modifiedFiles);
  }
}
