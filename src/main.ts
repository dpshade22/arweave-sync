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

export default class ArweaveSync extends Plugin {
  settings: ArweaveSyncSettings;
  private arweaveUploader: ArweaveUploader;
  private aoManager: AOManager;
  private arweave: Arweave;
  private walletAddress: string | null = null;
  private statusBarItem: HTMLElement;
  private modifiedFiles: Set<string> = new Set();

  constructor(app: App, manifest: any) {
    super(app, manifest);
    this.arweaveUploader = new ArweaveUploader();
    this.aoManager = new AOManager();
    this.arweave = Arweave.init({});
  }

  async onload() {
    await this.loadSettings();

    // Initialize wallet manager
    initializeWalletManager();

    walletManager.on("wallet-loaded", () => {
      const jwk = walletManager.getJWK();
      this.handleWalletConnection(jwk);
    });

    walletManager.on("wallet-connected", (walletJson: string) => {
      this.handleWalletConnection(JSON.parse(walletJson));
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

    // Add sync button to note headers
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf) {
          this.addSyncButtonToLeaf(leaf);
        }
      }),
    );

    // Add sync buttons to existing leaves
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.addSyncButtonToLeaf(leaf);
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

  private addSyncButton(view: MarkdownView) {
    const headerEl = view.containerEl.querySelector(".view-header");
    if (!headerEl) return;

    // Remove existing sync button if any
    const existingButton = headerEl.querySelector(".arweave-sync-button");
    if (existingButton) {
      existingButton.remove();
    }

    const syncButton = headerEl.createEl("button", {
      cls: "arweave-sync-button",
    });

    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>sync</title><path d="M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z" /></svg>`;

    syncButton.innerHTML = svgIcon;

    syncButton.addEventListener("click", async (e) => {
      e.stopPropagation(); // Prevent event from bubbling up
      const file = view.file;
      if (file) {
        syncButton.addClass("uploading");
        await this.syncFile(file);
        syncButton.removeClass("uploading");
      }
    });

    // Insert the button as the first child of the header
    headerEl.insertBefore(syncButton, headerEl.firstChild);
  }

  private addSyncButtonToLeaf(leaf: WorkspaceLeaf) {
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      this.addSyncButton(view);
    }
  }

  async handleWalletConnection(jwk: JWKInterface | null) {
    if (!jwk) {
      console.error("No wallet JWK provided");
      new Notice("Failed to connect wallet. No JWK provided.");
      return;
    }

    try {
      this.walletAddress = await this.arweave.wallets.jwkToAddress(jwk);
      this.arweaveUploader.setWallet(jwk);
      await this.aoManager.initialize(jwk);
      this.updateStatusBar();
      new Notice("Wallet connected successfully");
      await this.fetchUploadConfigFromAO();
    } catch (error) {
      console.error("Failed to handle wallet connection:", error);
      new Notice("Failed to connect wallet. Please try again.");
    }
  }

  async handleWalletDisconnection() {
    this.walletAddress = null;
    this.arweaveUploader.setWallet(null);
    await this.aoManager.initialize(null);
    this.updateStatusBar();
    new Notice("Wallet disconnected successfully");
  }

  async fetchUploadConfigFromAO() {
    try {
      const aoUploadConfig = await this.aoManager.getUploadConfig();
      if (aoUploadConfig) {
        this.settings.uploadConfig = aoUploadConfig;
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
    if (!this.settings.uploadConfig) {
      this.settings.uploadConfig = {};
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

      this.settings.uploadConfig[file.path] = {
        txId,
        timestamp: Date.now(),
        fileHash,
        encrypted: true,
        filePath: file.path,
      };

      await this.saveSettings();
      await this.aoManager.updateUploadConfig(this.settings.uploadConfig);

      this.modifiedFiles.delete(file.path);

      new Notice(`File ${file.name} synced to Arweave (encrypted)`);
    } catch (error) {
      new Notice(`Failed to sync file: ${error.message}`);
    } finally {
      if (syncButton) {
        syncButton.removeClass("uploading");
      }
    }
  }

  async updateFileInfo(file: TFile) {
    console.log("File updated:", file.path);

    const newHash = await this.getFileHash(file);

    if (!this.settings.uploadConfig[file.path]) {
      console.log("File not in uploadConfig, adding it");
      this.settings.uploadConfig[file.path] = {
        txId: "", // You might want to set this to a proper value
        timestamp: Date.now(),
        fileHash: newHash,
        encrypted: false,
        filePath: file.path,
      };
      this.modifiedFiles.add(file.path);
    } else if (this.settings.uploadConfig[file.path].fileHash !== newHash) {
      console.log("File hash changed, updating");
      this.settings.uploadConfig[file.path].fileHash = newHash;
      this.settings.uploadConfig[file.path].timestamp = Date.now();
      this.modifiedFiles.add(file.path);
    } else {
      console.log("File hash unchanged, no update needed");
      return;
    }

    console.log("Saving updated uploadConfig");
    await this.saveSettings();
    await this.aoManager.updateUploadConfig(this.settings.uploadConfig);
  }

  async handleFileRename(file: TFile, oldPath: string) {
    if (this.settings.uploadConfig[oldPath]) {
      console.log("file renamed");
      this.settings.uploadConfig[file.path] =
        this.settings.uploadConfig[oldPath];
      delete this.settings.uploadConfig[oldPath];
      this.modifiedFiles.delete(oldPath);
      this.modifiedFiles.add(file.path);
      await this.saveSettings();
      await this.aoManager.updateUploadConfig(this.settings.uploadConfig);
    }
  }

  async handleFileDelete(file: TFile) {
    if (this.settings.uploadConfig[file.path]) {
      console.log("file deleted");
      delete this.settings.uploadConfig[file.path];
      this.modifiedFiles.delete(file.path);
      await this.saveSettings();
      await this.aoManager.updateUploadConfig(this.settings.uploadConfig);
    }
  }

  async getFileHash(file: TFile): Promise<string> {
    const content = await this.app.vault.read(file);
    let dataToHash = content;
    if (this.settings.encryptionPassword) {
      dataToHash = encrypt(content, this.settings.encryptionPassword);
    }
    const buffer = await this.arweave.utils.stringToBuffer(dataToHash);
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
}
