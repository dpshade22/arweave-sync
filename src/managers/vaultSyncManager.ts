import Arweave from "arweave";
import {
  Vault,
  TFile,
  Notice,
  TFolder,
  MarkdownView,
  normalizePath,
} from "obsidian";
import { UploadConfig, FileUploadInfo, FileVersion } from "../types";
import { encrypt, decrypt } from "../utils/encryption";
import CryptoJS from "crypto-js";
import ArweaveSync from "../main";
import { arGql, GQLUrls } from "ar-gql";
import { walletManager } from "./walletManager";
import { Buffer } from "buffer";
import { dirname, basename } from "../utils/path";
import { LogManager } from "../utils/logManager";

export class VaultSyncManager {
  private vault: Vault;
  private arweave: Arweave;
  private argql: ReturnType<typeof arGql>;
  private encryptionPassword: string | null = null;
  private logger: LogManager;

  constructor(
    private plugin: ArweaveSync,
    private remoteUploadConfig: UploadConfig,
    private localUploadConfig: UploadConfig,
    logger?: LogManager,
  ) {
    this.vault = plugin.app.vault;
    this.arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });
    this.argql = arGql();
    this.logger = logger || new LogManager(plugin, "VaultSyncManager");
  }

  private ensureWalletConnected(): void {
    if (!walletManager.isConnected()) {
      throw new Error(
        "Wallet not connected. Please connect a wallet before proceeding.",
      );
    }
  }

  private ensureEncryptionPassword(): void {
    if (!this.encryptionPassword) {
      throw new Error(
        "Encryption password is not set. Please connect a wallet first.",
      );
    }
  }

  setEncryptionPassword(password: string): void {
    this.encryptionPassword = password;
  }

  isEncryptionPasswordSet(): boolean {
    return this.encryptionPassword !== null;
  }

  async syncFiles(files: TFile[]): Promise<void> {
    const filesToSync = files.filter(file => this.shouldSyncFile(file));
    if (filesToSync.length > 0) {
      this.logger.info(`Syncing ${filesToSync.length} files`);
      await this.syncFilesInternal(filesToSync);
      this.logger.info(`Sync completed`);
    }
  }

  private async syncFilesInternal(files: TFile[]): Promise<void> {
    const updatedConfigs: { [key: string]: FileUploadInfo } = {};

    try {
      for (const file of files) {
        const result = await this.syncFileInternal(file);
        if (result) {
          updatedConfigs[result.filePath] = result.fileInfo;
        }
      }

      Object.assign(this.remoteUploadConfig, updatedConfigs);
      Object.assign(this.localUploadConfig, updatedConfigs);

      await this.plugin.aoManager.updateUploadConfig(this.remoteUploadConfig);
      await this.plugin.saveSettings();
    } catch (error) {
      this.logger.error(`Sync error: ${error.message}`);
      throw error;
    }
  }

  private async syncFileInternal(
    file: TFile,
  ): Promise<{ filePath: string; fileInfo: FileUploadInfo } | null> {
    const { syncState, fileHash } = await this.checkFileSync(file);

    if (syncState === "synced") {
      return null;
    }

    let newFileInfo: FileUploadInfo | null = null;

    try {
      switch (this.plugin.settings.syncDirection) {
        case "uploadOnly":
          if (syncState === "new-local" || syncState === "local-newer") {
            newFileInfo = await this.exportFileToArweave(file, fileHash);
          }
          break;
        case "downloadOnly":
          if (syncState === "new-remote" || syncState === "remote-newer") {
            await this.importFileFromArweave(file.path);
            newFileInfo = this.remoteUploadConfig[file.path];
          }
          break;
        case "bidirectional":
        default:
          if (syncState === "new-local" || syncState === "local-newer") {
            newFileInfo = await this.exportFileToArweave(file, fileHash);
          } else if (syncState === "new-remote" || syncState === "remote-newer") {
            await this.importFileFromArweave(file.path);
            newFileInfo = this.remoteUploadConfig[file.path];
          }
          break;
      }
    } catch (error) {
      this.logger.error(`Sync failed for ${file.path}: ${error.message}`);

    }

    return newFileInfo ? { filePath: file.path, fileInfo: newFileInfo } : null;
  }

  async checkMultipleFileSync(
    files: TFile[],
  ): Promise<Map<string, { syncState: string; fileHash: string }>> {
    const results = new Map();
    const batchSize = 10;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((file) => this.checkFileSync(file)),
      );
      batchResults.forEach((result, index) => {
        results.set(batch[index].path, result);
      });
    }

    return results;
  }

  async syncFile(file: TFile, updateConfig: boolean = true): Promise<void> {
    this.logger.debug(`Starting sync for file: ${file.path}`);

    const result = await this.syncFileInternal(file);

    if (result) {
      this.updateConfigs(result.filePath, result.fileInfo);

      if (updateConfig) {
        await this.plugin.aoManager.updateUploadConfig(this.remoteUploadConfig);
        await this.plugin.saveSettings();
      }
    }

    this.logger.debug(`Completed sync for file: ${file.path}`);
  }

  private updateConfigs(filePath: string, fileInfo: FileUploadInfo): void {
    this.localUploadConfig[filePath] = fileInfo;
    this.remoteUploadConfig[filePath] = fileInfo;
    this.plugin.updateLocalConfig(filePath, fileInfo);
  }

  private shouldSyncFile(file: TFile): boolean {
    const settings = this.plugin.settings;

    if (
      settings.filesToSync === "selected" &&
      !settings.selectedFoldersToSync.some((folder) =>
        file.path.startsWith(folder),
      )
    ) {
      this.logger.debug(
        `File ${file.path} not in selected folders. Skipping sync.`,
      );
      return false;
    }

    if (
      settings.excludedFolders.length > 0 &&
      settings.excludedFolders.some(
        (folder) => folder !== "/" && file.path.startsWith(folder + "/"),
      )
    ) {
      this.logger.debug(`File ${file.path} in excluded folder. Skipping sync.`);
      return false;
    }

    if (!settings.syncFileTypes.includes(`.${file.extension}`)) {
      this.logger.debug(
        `File ${file.path} not of syncable type. Skipping sync.`,
      );
      return false;
    }

    this.logger.debug(`File ${file.path} should be synced.`);
    return true;
  }

  async performFullSync(): Promise<void> {
    await this.updateRemoteConfig();
    const filesToSync = this.getFilesToSync();
    await this.syncFiles(filesToSync);
  }

  public getFilesToSync(): TFile[] {
    return this.plugin.app.vault
      .getFiles()
      .filter((file) => this.shouldSyncFile(file));
  }

  async importFilesFromArweave(filePaths: string[]): Promise<string[]> {
    const importedFiles: string[] = [];

    for (const filePath of filePaths) {
      try {
        await this.importFileFromArweave(filePath);
        importedFiles.push(filePath);
      } catch (error) {
        this.logger.error(`Failed to import file: ${filePath}`, error);
      }
    }

    await this.plugin.aoManager.updateUploadConfig(this.remoteUploadConfig);
    return importedFiles;
  }

  async importFileFromArweave(filePath: string): Promise<void> {
    this.ensureEncryptionPassword();

    try {
      const normalizedPath = normalizePath(filePath);
      const remoteFileInfo = this.remoteUploadConfig[filePath];
      if (!remoteFileInfo) {
        throw new Error(`No remote file info found for ${filePath}`);
      }

      await this.remoteRename(normalizedPath, remoteFileInfo);

      const encryptedContent = await this.fetchEncryptedContent(
        remoteFileInfo.txId,
      );

      let decryptedContent: string | ArrayBuffer;
      try {
        decryptedContent = this.decrypt(encryptedContent);
      } catch (decryptError) {
        this.logger.error(`Failed to decrypt ${filePath}:`, decryptError);
        await this.handleDecryptionFailure(filePath);
        return;
      }

      const existingFile =
        this.plugin.app.vault.getAbstractFileByPath(normalizedPath);

      if (existingFile instanceof TFile) {
        await this.updateExistingFile(existingFile, decryptedContent);
        this.logger.info(`Updated existing file: ${normalizedPath}`);
      } else if (existingFile instanceof TFolder) {
        const uniquePath = this.generateUniqueFilePath(normalizedPath);
        await this.createNewFile(uniquePath, decryptedContent);
        this.logger.info(`Created new file with modified path: ${uniquePath}`);
      } else {
        if (normalizedPath.includes("/")) {
          await this.ensureDirectoryExists(normalizedPath);
        }
        await this.createNewFile(normalizedPath, decryptedContent);
        this.logger.info(`Created new file: ${normalizedPath}`);
      }

      this.updateConfigs(filePath, {
        ...remoteFileInfo,
        filePath: normalizedPath,
      });
      await this.plugin.saveSettings();

      this.logger.info(`Imported file: ${normalizedPath}`);
    } catch (error) {
      this.logger.error(`Failed to import file: ${filePath}`, error);
      throw error;
    }
  }

  private async createNewFile(
    path: string,
    content: string | ArrayBuffer,
  ): Promise<void> {
    if (content instanceof ArrayBuffer) {
      await this.plugin.app.vault.createBinary(path, content);
    } else {
      await this.plugin.app.vault.create(path, content);
    }
  }

  private async updateExistingFile(
    file: TFile,
    content: string | ArrayBuffer,
  ): Promise<void> {
    const activeView =
      this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file === file) {
      const editor = activeView.editor;
      if (typeof content === "string") {
        editor.setValue(content);
      } else {
        new Notice(`Binary file ${file.name} has been updated.`);
        await this.plugin.app.vault.modifyBinary(file, content);
      }
    } else {
      if (typeof content === "string") {
        await this.plugin.app.vault.modify(file, content);
      } else {
        await this.plugin.app.vault.modifyBinary(file, content);
      }
    }
  }

  private generateUniqueFilePath(originalPath: string): string {
    let newPath = originalPath;
    let counter = 1;
    while (this.plugin.app.vault.getAbstractFileByPath(newPath)) {
      const dir = dirname(originalPath);
      const name = basename(originalPath).replace(/\.[^/.]+$/, "");
      const ext = basename(originalPath).split(".").pop() || "";
      newPath = normalizePath(
        `${dir}/${name}_${counter}${ext ? "." + ext : ""}`,
      );
      counter++;
    }
    return newPath;
  }

  public async forcePushFile(file: TFile): Promise<void> {
    try {
      const fileHash = await this.getFileHash(file);
      const newFileInfo = await this.exportFileToArweave(file, fileHash);

      this.updateConfigs(file.path, newFileInfo);
      await this.plugin.aoManager.updateUploadConfig(this.remoteUploadConfig);
      this.logger.info(`Force pushed file: ${file.path}`);
      new Notice(`Successfully force pushed ${file.name} to Arweave`);
    } catch (error) {
      this.logger.error(`Failed to force push file: ${file.path}`, error);
    }
  }

  public async forcePullFile(file: TFile): Promise<void> {
    try {
      const remoteFileInfo = this.remoteUploadConfig[file.path];
      if (!remoteFileInfo) {
        throw new Error(`No remote file info found for ${file.path}`);
      }

      const encryptedContent = await this.fetchEncryptedContent(
        remoteFileInfo.txId,
      );
      let decryptedContent: string | Buffer;

      try {
        decryptedContent = this.decrypt(encryptedContent);
      } catch (decryptError) {
        this.logger.error(`Failed to decrypt ${file.path}:`, decryptError);
        throw new Error(
          `Failed to decrypt ${file.path}. Please check your encryption password.`,
        );
      }

      if (await this.plugin.app.vault.adapter.exists(file.path)) {
        if (Buffer.isBuffer(decryptedContent)) {
          await this.plugin.app.vault.modifyBinary(
            file,
            decryptedContent.buffer,
          );
        } else if (typeof decryptedContent === "string") {
          await this.plugin.app.vault.modify(file, decryptedContent);
        } else {
          throw new Error(`Unexpected decrypted content type for ${file.path}`);
        }
      } else {
        if (Buffer.isBuffer(decryptedContent)) {
          await this.plugin.app.vault.createBinary(
            file.path,
            decryptedContent.buffer,
          );
        } else if (typeof decryptedContent === "string") {
          await this.plugin.app.vault.create(file.path, decryptedContent);
        }
      }

      this.updateConfigs(file.path, remoteFileInfo);
      await this.plugin.saveSettings();

      this.logger.info(`Force pulled file: ${file.path}`);
      new Notice(`Successfully force pulled ${file.name} from Arweave`);
    } catch (error) {
      this.logger.error(`Failed to force pull file: ${file.path}`, error);
    }
  }

  private async handleDecryptionFailure(filePath: string): Promise<void> {
    this.logger.warn(
      `Removing ${filePath} from remote upload config due to decryption failure`,
    );

    delete this.remoteUploadConfig[filePath];
    await this.plugin.aoManager.updateUploadConfig(this.remoteUploadConfig);

    new Notice(
      `Failed to decrypt ${filePath}. It has been removed from the sync list.`,
    );
  }

  public async deleteRemoteFile(filePath: string): Promise<void> {
    this.logger.info(`Removing ${filePath} from remote upload config`);

    delete this.remoteUploadConfig[filePath];
    await this.plugin.aoManager.updateUploadConfig(this.remoteUploadConfig);

    new Notice(`Deleting ${filePath}. It has been removed from the sync list.`);
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    if (dir && dir !== ".") {
      const folders = dir.split("/").filter(Boolean);
      let currentPath = "";

      for (const folder of folders) {
        currentPath += (currentPath ? "/" : "") + folder;
        const folderFile =
          this.plugin.app.vault.getAbstractFileByPath(currentPath);

        if (!folderFile) {
          try {
            await this.plugin.app.vault.createFolder(currentPath);
          } catch (error) {
            if (error.message !== "Folder already exists.") {
              throw error;
            }
          }
        } else if (!(folderFile instanceof TFolder)) {
          throw new Error(`${currentPath} exists but is not a folder`);
        }
      }
    }
  }

  private async exportFileToArweave(
    file: TFile,
    fileHash: string,
  ): Promise<FileUploadInfo> {
    this.ensureWalletConnected();
    this.ensureEncryptionPassword();

    const wallet = walletManager.getJWK();
    if (!wallet) {
      throw new Error("Unable to retrieve wallet. Please try reconnecting.");
    }

    const isBinary = this.isBinaryFile(file);
    const content = isBinary
      ? await this.vault.readBinary(file)
      : await this.vault.read(file);
    const encryptedContent = this.encrypt(
      content instanceof ArrayBuffer ? Buffer.from(content) : content,
      isBinary,
    );

    const transaction = await this.createArweaveTransaction(
      encryptedContent,
      wallet,
      file,
      fileHash,
    );
    await this.arweave.transactions.sign(transaction, wallet);
    const response = await this.arweave.transactions.post(transaction);

    if (response.status !== 200) {
      throw new Error(
        `Upload failed with status ${response.status}: ${response.statusText}`,
      );
    }

    const newFileInfo: FileUploadInfo = {
      txId: transaction.id,
      timestamp: Date.now(),
      fileHash,
      encrypted: true,
      filePath: file.path,
      previousVersionTxId: this.getPreviousVersionTxId(file.path),
      versionNumber: this.getNextVersionNumber(file.path),
    };

    await this.plugin.incrementFilesSynced();

    return newFileInfo;
  }

  private async createArweaveTransaction(
    encryptedContent: string,
    wallet: any,
    file: TFile,
    fileHash: string,
  ): Promise<any> {
    const transaction = await this.arweave.createTransaction(
      { data: encryptedContent },
      wallet,
    );

    const tags = [
      { name: "Content-Type", value: "text/markdown" },
      { name: "App-Name", value: "ArweaveSync" },
      { name: "File-Hash", value: fileHash },
      {
        name: "Previous-Version",
        value: this.getPreviousVersionTxId(file.path) || "",
      },
      {
        name: "Version-Number",
        value: this.getNextVersionNumber(file.path).toString(),
      },
      { name: "File-Path", value: file.path },
    ];

    tags.forEach((tag) => transaction.addTag(tag.name, tag.value));

    return transaction;
  }

  private getPreviousVersionTxId(filePath: string): string | null {
    const currentFileInfo = this.localUploadConfig[filePath];
    return currentFileInfo ? currentFileInfo.txId : null;
  }

  private getNextVersionNumber(filePath: string): number {
    const currentFileInfo = this.localUploadConfig[filePath];
    return currentFileInfo ? currentFileInfo.versionNumber + 1 : 1;
  }

  async exportFilesToArweave(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        const { syncState, fileHash } = await this.checkFileSync(file);
        if (syncState !== "synced") {
          const newFileInfo = await this.exportFileToArweave(file, fileHash);
          this.updateConfigs(filePath, newFileInfo);
        }
      }
    }

    await this.plugin.aoManager.updateUploadConfig(this.remoteUploadConfig);
    await this.plugin.saveSettings();
  }

  public async updateRemoteConfig(): Promise<void> {
    const remoteConfig = await this.plugin.aoManager.getUploadConfig();
    this.logger.debug("Remote config:", remoteConfig);
    this.remoteUploadConfig = remoteConfig || {};
    this.plugin.settings.remoteUploadConfig = remoteConfig || {};
    await this.plugin.saveSettings();
  }

  async fetchContentForTx(txId: string): Promise<string | Buffer> {
    const encryptedContent = await this.fetchEncryptedContent(txId);
    return this.decrypt(encryptedContent);
  }

  public async isFileNeedingSync(file: TFile): Promise<boolean> {
    const { syncState } = await this.checkFileSync(file);
    return syncState !== "synced";
  }

  async checkFileSync(file: TFile): Promise<{
    syncState:
    | "new-local"
    | "new-remote"
    | "local-newer"
    | "remote-newer"
    | "synced"
    | "decrypt-failed";
    fileHash: string;
  }> {
    const currentFileHash = await this.getFileHash(file);
    const remoteFileInfo = this.remoteUploadConfig[file.path];
    const localFileInfo = this.localUploadConfig[file.path];

    let syncState:
      | "new-local"
      | "new-remote"
      | "local-newer"
      | "remote-newer"
      | "synced"
      | "decrypt-failed";

    if (!remoteFileInfo && localFileInfo) {
      syncState = "new-local";
    } else if (!localFileInfo && remoteFileInfo) {
      try {
        const encryptedContent = await this.fetchEncryptedContent(
          remoteFileInfo.txId,
        );
        this.decrypt(encryptedContent);
        syncState = "new-remote";
      } catch (decryptError) {
        this.logger.error(`Failed to decrypt ${file.path}:`, decryptError);
        await this.handleDecryptionFailure(file.path);
        syncState = "decrypt-failed";
      }
    } else if (currentFileHash !== remoteFileInfo?.fileHash) {
      if (remoteFileInfo && remoteFileInfo.timestamp > file.stat.mtime) {
        syncState = "remote-newer";
      } else {
        syncState = "local-newer";
      }
    } else {
      syncState = "synced";
    }

    return { syncState, fileHash: currentFileHash };
  }

  public async getFileHash(file: TFile): Promise<string> {
    const isBinary = this.isBinaryFile(file);
    const content = isBinary
      ? await this.plugin.app.vault.readBinary(file)
      : await this.plugin.app.vault.read(file);

    if (isBinary) {
      return CryptoJS.SHA256(
        CryptoJS.lib.WordArray.create(content as ArrayBuffer),
      ).toString();
    } else {
      return CryptoJS.SHA256(content as string).toString();
    }
  }

  private async fetchEncryptedContent(
    txId: string,
    maxRetries = 3,
  ): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const transaction = await this.arweave.transactions.getData(txId, {
          decode: true,
          string: true,
        });
        return transaction as string;
      } catch (error) {
        this.logger.warn(
          `Attempt ${attempt + 1} failed to fetch content for txId ${txId}:`,
          error,
        );
        if (attempt === maxRetries - 1) {
          throw new Error(
            `Failed to fetch content for txId ${txId} after ${maxRetries} attempts.`,
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * Math.pow(2, attempt)),
        );
      }
    }
    throw new Error("Unexpected error in fetchEncryptedContent");
  }

  async fetchLatestRemoteFileContent(filePath: string): Promise<string> {
    this.ensureEncryptionPassword();

    const fileInfo = this.remoteUploadConfig[filePath];
    if (!fileInfo) {
      throw new Error(`No remote file info found for ${filePath}`);
    }

    const encryptedContent = await this.fetchEncryptedContent(fileInfo.txId);
    const decryptedContent = this.decrypt(encryptedContent);

    if (typeof decryptedContent === "string") {
      return decryptedContent;
    } else {
      return decryptedContent.toString("utf-8");
    }
  }

  async fetchFileVersions(
    limit: number = 10,
    filePath?: string,
    startFromTxId?: string,
  ): Promise<FileVersion[]> {
    const versions: FileVersion[] = [];
    let currentTxId =
      startFromTxId ||
      (filePath ? this.getCurrentTransactionId(filePath) : null);

    const fetchVersion = async (txId: string | null): Promise<void> => {
      if (!txId || versions.length >= limit) {
        return;
      }

      const query = `
        query($id: ID!) {
          transaction(id: $id) {
            id
            tags {
              name
              value
            }
            block {
              height
              timestamp
            }
          }
        }
      `;

      try {
        const variables = { id: txId };
        const results = await arGql({ endpointUrl: GQLUrls.goldsky }).run(
          query,
          variables,
        );
        const transaction = results.data.transaction;

        if (!transaction) {
          return;
        }

        const data = await this.arweave.transactions.getData(txId, {
          decode: true,
          string: true,
        });

        const content =
          typeof data === "string" ? data : new TextDecoder().decode(data);
        const decryptedContent = this.decrypt(content);

        const fileHash = transaction.tags.find(
          (tag) => tag.name === "File-Hash",
        )?.value;
        const previousVersionTxId =
          transaction.tags.find((tag) => tag.name === "Previous-Version")
            ?.value || null;

        versions.push({
          txId,
          content: decryptedContent,
          timestamp: transaction.block.timestamp,
          previousVersionTxId,
        });

        await fetchVersion(previousVersionTxId);
      } catch (error) {
        this.logger.error("Error fetching version:", error);
      }
    };

    await fetchVersion(currentTxId);
    return versions;
  }

  private async remoteRename(
    filePath: string,
    remoteFileInfo: FileUploadInfo,
  ): Promise<void> {
    if (remoteFileInfo.oldFilePath) {
      const oldFile = this.plugin.app.vault.getAbstractFileByPath(
        remoteFileInfo.oldFilePath,
      );
      if (oldFile instanceof TFile) {
        try {
          await this.plugin.app.fileManager.renameFile(oldFile, filePath);
          this.logger.info(`Renamed ${remoteFileInfo.oldFilePath} to ${filePath}`);
        } catch (error) {
          this.logger.error(`Rename failed ${remoteFileInfo.oldFilePath} to ${filePath}: ${error.message}`);
          throw new Error(`Failed to rename file: ${error.message}`);
        }
      }
    }
  }

  private getCurrentTransactionId(filePath: string): string | null {
    const fileInfo = this.localUploadConfig[filePath];
    return fileInfo ? fileInfo.txId : null;
  }

  public isBinaryFile(file: TFile): boolean {
    const binaryExtensions = [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "pdf",
      "mp3",
      "mp4",
      "zip",
    ];
    return binaryExtensions.includes(file.extension.toLowerCase());
  }

  async syncAllFiles(): Promise<void> {
    const filesToSync = this.getFilesToSync();
    await this.syncFiles(filesToSync);
  }

  // Helper methods for encryption and decryption
  public encrypt(data: string | Buffer, isBinary: boolean = false): string {
    this.ensureEncryptionPassword();
    return encrypt(data, this.encryptionPassword!, isBinary);
  }

  public decrypt(encryptedData: string): string | Buffer {
    this.ensureEncryptionPassword();
    return decrypt(encryptedData, this.encryptionPassword!);
  }

  public isWalletConnected(): boolean {
    return walletManager.isConnected();
  }
}