import {
  Plugin,
  TFile,
  addIcon,
  MarkdownView,
  Notice,
  App,
  Setting,
} from "obsidian";
import { ArweaveUploader } from "./managers/arweaveUploader";
import { AOManager } from "./managers/aoManager";
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

export default class ArweaveSync extends Plugin {
  settings: ArweaveSyncSettings;
  uploadConfig: UploadConfig = {};
  private arweaveUploader: ArweaveUploader;
  private aoManager: AOManager;
  private arweave: Arweave;
  private walletAddress: string | null = null;
  private statusBarItem: HTMLElement;

  constructor(app: App, manifest: any) {
    super(app, manifest);
    this.arweaveUploader = new ArweaveUploader();
    this.aoManager = new AOManager();
    this.arweave = Arweave.init({});
  }

  async onload() {
    await this.loadSettings();

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

  async handleWalletConnection(jwk: JWKInterface) {
    try {
      this.walletAddress = await this.arweave.wallets.jwkToAddress(jwk);
      this.arweaveUploader.setWallet(jwk);
      this.updateStatusBar();
      new Notice("Wallet connected successfully");
    } catch (error) {
      console.error("Failed to handle wallet connection:", error);
      new Notice("Failed to connect wallet. Please try again.");
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async syncFile(file: TFile) {
    try {
      const content = await this.app.vault.read(file);
      const txId = await this.arweaveUploader.uploadFile(file.path, content);

      this.uploadConfig[file.path] = {
        txId,
        timestamp: Date.now(),
        fileHash: await this.getFileHash(file),
        encrypted: false,
        folderPath: file.parent?.path || "",
        filePath: file.path,
        fileName: file.name,
      };

      await this.saveData(this.uploadConfig);
      await this.aoManager.updateUploadConfig(this.uploadConfig);

      new Notice(`File ${file.name} synced to Arweave`);
    } catch (error) {
      new Notice(`Failed to sync file: ${error.message}`);
    }
  }

  async updateFileInfo(file: TFile) {
    const newHash = await this.getFileHash(file);
    if (
      this.uploadConfig[file.path] &&
      this.uploadConfig[file.path].fileHash !== newHash
    ) {
      this.uploadConfig[file.path].fileHash = newHash;
      this.uploadConfig[file.path].timestamp = Date.now();
      await this.saveData(this.uploadConfig);
      await this.aoManager.updateUploadConfig(this.uploadConfig);
    }
  }

  async handleFileRename(file: TFile, oldPath: string) {
    if (this.uploadConfig[oldPath]) {
      this.uploadConfig[file.path] = this.uploadConfig[oldPath];
      delete this.uploadConfig[oldPath];
      await this.saveData(this.uploadConfig);
      await this.aoManager.updateUploadConfig(this.uploadConfig);
    }
  }

  async handleFileDelete(file: TFile) {
    if (this.uploadConfig[file.path]) {
      delete this.uploadConfig[file.path];
      await this.saveData(this.uploadConfig);
      await this.aoManager.updateUploadConfig(this.uploadConfig);
    }
  }

  async getFileHash(file: TFile): Promise<string> {
    const content = await this.app.vault.read(file);
    const buffer = await this.arweave.utils.stringToBuffer(content);
    return await this.arweave.utils.bufferTob64Url(
      await this.arweave.crypto.hash(buffer),
    );
  }

  addStatusBarItem(): HTMLElement {
    return super.addStatusBarItem();
  }
}
